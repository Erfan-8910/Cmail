// Cmail — authentication: sessions, cookies, rate limiting
import { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, SessionUser } from './util';
export type { SessionUser };
import { randomToken, now } from './util';



const SESSION_COOKIE = 'cmail_session';

export async function createSession(env: Env, userId: string, ua?: string, ip?: string): Promise<string> {
  const token = randomToken(36);
  const days = parseInt((await env.DB.prepare("SELECT value FROM settings WHERE key='session_days'").first<{ value: string }>())?.value ?? '30', 10) || 30;
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at, ua, ip) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(token, userId, now(), now() + days * 86400_000, (ua ?? '').slice(0, 200), (ip ?? '').slice(0, 64)).run();
  return token;
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export async function getUserFromToken(env: Env, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.display_name, u.totp_enabled, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`
  ).bind(token).first<SessionUser & { expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  return { id: row.id, username: row.username, role: row.role, display_name: row.display_name, totp_enabled: row.totp_enabled };
}

export function tokenFrom(c: Context): string | undefined {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) return cookie;
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return undefined;
}

// middleware: attach user if any
// (fail-open: a half-configured deployment must not explode here —
//  the diagnostics page / setup wizard handles that path)
export async function attachUser(c: Context, next: Next) {
  let user: SessionUser | null = null;
  try {
    user = await getUserFromToken(c.env as Env, tokenFrom(c));
  } catch { user = null; }
  c.set('user', user);
  await next();
}

// middleware: require authenticated user
export async function requireUser(c: Context, next: Next) {
  const user = c.get('user') as SessionUser | null;
  if (!user) return c.json({ ok: false, error: 'unauthorized' }, 401);
  await next();
}

// middleware: require admin role
export async function requireAdmin(c: Context, next: Next) {
  const user = c.get('user') as SessionUser | null;
  if (!user) return c.json({ ok: false, error: 'unauthorized' }, 401);
  if (user.role !== 'admin') return c.json({ ok: false, error: 'forbidden' }, 403);
  await next();
}

export async function destroySession(env: Env, token: string | undefined) {
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

// ---------- rate limiting (auth endpoints) ----------
// persistent counter in D1, 10 attempts / 10 minutes per ip+route

export async function rateLimit(env: Env, ip: string, route: string, max = 10, windowMs = 10 * 60_000): Promise<boolean> {
  try {
    const key = `${route}:${ip}`;
    const t = now();
    const row = await env.DB!.prepare('SELECT count, window_start FROM auth_attempts WHERE key = ?').bind(key)
      .first<{ count: number; window_start: number }>();
    if (!row || t - row.window_start > windowMs) {
      await env.DB!.prepare(
        'INSERT INTO auth_attempts (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start'
      ).bind(key, t).run();
      return true;
    }
    if (row.count >= max) return false;
    await env.DB!.prepare('UPDATE auth_attempts SET count = count + 1 WHERE key = ?').bind(key).run();
    return true;
  } catch {
    // auth_attempts not created yet (pre-init) → do not block setup flows
    return true;
  }
}

export async function rateLimitClear(env: Env, ip: string, route: string) {
  try {
    await env.DB!.prepare('DELETE FROM auth_attempts WHERE key = ?').bind(`${route}:${ip}`).run();
  } catch { /* table may not exist yet */ }
}

export function clientIp(c: Context): string {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0].trim() || '0.0.0.0';
}
