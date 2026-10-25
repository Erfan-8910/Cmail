// Cmail — auth routes: register / login / 2FA login / me / password / account TOTP
import { Hono } from 'hono';
import type { Env, AppEnv, SessionUser } from '../util';
import {
  usernameValid, passwordStrong, hashPassword, verifyPassword, uid, now,
  getSetting, setSetting, sealText, openText, randomToken,
} from '../util';
import {
  createSession, setSessionCookie, clearSessionCookie, destroySession, tokenFrom,
  requireUser, clientIp, rateLimit, rateLimitClear
} from '../auth';
import { randomSecret, verifyTotp, buildOtpauthUri } from '../totp';
import { renderSVG } from 'uqr';

const app = new Hono<AppEnv>();

// current user
app.get('/me', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const unread = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM emails WHERE user_id = ? AND is_read = 0'
  ).bind(u.id).first<{ n: number }>();
  return c.json({ ok: true, user: u, unread: unread?.n ?? 0 });
});

// register (only if enabled by admin)
app.post('/register', async (c) => {
  const ip = clientIp(c);
  if (!(await rateLimit(c.env, ip, 'register', 8))) return c.json({ ok: false, error: 'rate_limited' }, 429);

  const mode = (await getSetting(c.env, 'registration')) ?? 'closed';
  if (mode !== 'open') return c.json({ ok: false, error: 'registration_closed' }, 403);

  const body = await c.req.json<{ username?: string; password?: string; display_name?: string }>().catch(() => null);
  const username = (body?.username ?? '').trim();
  const password = body?.password ?? '';
  if (!usernameValid(username)) return c.json({ ok: false, error: 'invalid_username' }, 400);
  if (!passwordStrong(password)) return c.json({ ok: false, error: 'weak_password' }, 400);

  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (exists) return c.json({ ok: false, error: 'username_taken' }, 409);

  const id = uid('usr_');
  await c.env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, role, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, username, await hashPassword(password), 'user', (body?.display_name ?? '').slice(0, 60) || null, now()).run();

  const token = await createSession(c.env, id, c.req.header('User-Agent'), ip);
  setSessionCookie(c, token);
  return c.json({ ok: true, user: { id, username, role: 'user' } });
});

// step 1: password login → may ask for 2FA
app.post('/login', async (c) => {
  const ip = clientIp(c);
  if (!(await rateLimit(c.env, ip, 'login', 10))) return c.json({ ok: false, error: 'rate_limited' }, 429);

  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => null);
  const username = (body?.username ?? '').trim();
  const password = body?.password ?? '';

  const user = await c.env.DB.prepare('SELECT id, username, role, password_hash, totp_enabled FROM users WHERE username = ?')
    .bind(username).first<{ id: string; username: string; role: string; password_hash: string; totp_enabled: number }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ ok: false, error: 'invalid_credentials' }, 401);
  }

  await rateLimitClear(c.env, ip, 'login');

  if (user.totp_enabled) {
    // short-lived pending token so the client can complete the 2FA step
    const pending = randomToken(24);
    await setSetting(c.env, `pending2fa:${pending}`, `${user.id}.${now() + 5 * 60_000}`);
    return c.json({ ok: true, totp_required: true, pending });
  }

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), user.id).run();
  const token = await createSession(c.env, user.id, c.req.header('User-Agent'), ip);
  setSessionCookie(c, token);
  return c.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
});

// step 2: complete login with TOTP
app.post('/login/totp', async (c) => {
  const ip = clientIp(c);
  if (!(await rateLimit(c.env, ip, 'totp', 10))) return c.json({ ok: false, error: 'rate_limited' }, 429);

  const body = await c.req.json<{ pending?: string; code?: string }>().catch(() => null);
  const pending = body?.pending ?? '';
  const code = (body?.code ?? '').trim();
  if (!pending || !/^\d{6,8}$/.test(code)) return c.json({ ok: false, error: 'invalid_request' }, 400);

  const val = await getSetting(c.env, `pending2fa:${pending}`);
  if (!val) return c.json({ ok: false, error: 'pending_expired' }, 401);
  const [userId, expStr] = val.split('.');
  if (Number(expStr) < now()) {
    await c.env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(`pending2fa:${pending}`).run();
    return c.json({ ok: false, error: 'pending_expired' }, 401);
  }

  const user = await c.env.DB.prepare('SELECT id, username, role, totp_secret FROM users WHERE id = ?')
    .bind(userId).first<{ id: string; username: string; role: string; totp_secret: string }>();
  if (!user || !user.totp_secret) return c.json({ ok: false, error: 'invalid_request' }, 400);

  const secret = await openText(c.env, user.totp_secret);
  if (!(await verifyTotp(secret, code))) return c.json({ ok: false, error: 'invalid_code' }, 401);

  await c.env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(`pending2fa:${pending}`).run();
  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), user.id).run();
  const token = await createSession(c.env, user.id, c.req.header('User-Agent'), ip);
  setSessionCookie(c, token);
  return c.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
});

app.post('/logout', async (c) => {
  await destroySession(c.env, tokenFrom(c));
  clearSessionCookie(c);
  return c.json({ ok: true });
});

// change password
app.post('/password', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const body = await c.req.json<{ current?: string; next?: string }>().catch(() => null);
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(u.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(body?.current ?? '', row.password_hash))) {
    return c.json({ ok: false, error: 'invalid_credentials' }, 401);
  }
  if (!passwordStrong(body?.next ?? '')) return c.json({ ok: false, error: 'weak_password' }, 400);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(body!.next!), u.id).run();
  return c.json({ ok: true });
});

// ---------- account login-2FA management ----------

// start enabling: returns secret + otpauth uri (not saved until verified)
app.post('/totp/start', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  if (u.totp_enabled) return c.json({ ok: false, error: 'totp_enabled' }, 409);
  const secret = randomSecret();
  const uri = buildOtpauthUri({ secret, issuer: 'Cmail', name: u.username, algo: 'SHA1', digits: 6, period: 30 });
  return c.json({ ok: true, secret, uri });
});

// confirm enabling with a code
app.post('/totp/enable', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const body = await c.req.json<{ secret?: string; code?: string }>().catch(() => null);
  const secret = (body?.secret ?? '').trim();
  const code = (body?.code ?? '').trim();
  if (!secret || !/^\d{6,8}$/.test(code)) return c.json({ ok: false, error: 'invalid_request' }, 400);
  if (!(await verifyTotp(secret, code))) return c.json({ ok: false, error: 'invalid_code' }, 401);
  const sealed = await sealText(c.env, secret);
  await c.env.DB.prepare('UPDATE users SET totp_enabled = 1, totp_secret = ? WHERE id = ?').bind(sealed, u.id).run();
  return c.json({ ok: true });
});

// QR svg for a not-yet-saved secret (account 2FA enrollment)
app.post('/totp/qr', requireUser, async (c) => {
  const body = await c.req.json<{ secret?: string; name?: string }>().catch(() => null);
  const secret = (body?.secret ?? '').trim();
  if (!secret) return c.json({ ok: false, error: 'invalid_request' }, 400);
  const u = c.get('user') as SessionUser;
  const uri = buildOtpauthUri({ secret, issuer: 'Cmail', name: body?.name ?? u.username, algo: 'SHA1', digits: 6, period: 30 });
  const svg = renderSVG(uri, { border: 1 });
  return c.body(svg, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
});

app.post('/totp/disable', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const body = await c.req.json<{ code?: string }>().catch(() => null);
  const row = await c.env.DB.prepare('SELECT totp_secret FROM users WHERE id = ?').bind(u.id).first<{ totp_secret: string }>();
  if (row?.totp_secret) {
    const secret = await openText(c.env, row.totp_secret);
    if (!(await verifyTotp(secret, (body?.code ?? '').trim()))) return c.json({ ok: false, error: 'invalid_code' }, 401);
  }
  await c.env.DB.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').bind(u.id).run();
  return c.json({ ok: true });
});

// pending2fa cleanup helper is handled by cron via settings scan
export default app;
