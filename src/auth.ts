// Cmail — authentication: sessions, cookies, rate limiting
import { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, SessionUser, ShareInfo } from './util';
export type { SessionUser };
import { randomToken, now, shareExpired, shareSuspended } from './util';



const SESSION_COOKIE = 'cmail_session';

export async function createSession(env: Env, userId: string, ua?: string, ip?: string, shareId?: string): Promise<string> {
  const token = randomToken(36);
  const days = parseInt((await env.DB.prepare("SELECT value FROM settings WHERE key='session_days'").first<{ value: string }>())?.value ?? '30', 10) || 30;
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, share_id, created_at, expires_at, ua, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(token, userId, shareId ?? null, now(), now() + days * 86400_000, (ua ?? '').slice(0, 200), (ip ?? '').slice(0, 64)).run();
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
  // ---------------------------------------------------------------------------
  //  Stage 1 — the session + the user it belongs to. This query touches ONLY
  //  tables and columns that exist since 0001/0002, never share_links: the
  //  owner's session must never die because a share column is missing.
  //  (Issue #2: databases built through the migration chain lacked two share
  //  columns, the old single query threw for EVERY request, attachUser
  //  swallowed it as "no user" and the panel bounced straight back to the
  //  login form right after a successful sign-in — the password was fine,
  //  the schema was not.)
  //  v3.1.1: locked_at rides along — the padlock's state is the SESSION's,
  //  enforced here on every request, never a client-side flag. Databases
  //  upgraded in place answer WITHOUT the column until migration 0013 (or
  //  the heal pass) adds it — the fallback below keeps every session alive
  //  in the meantime, unlocked. A missing column must never log anyone out.
  // ---------------------------------------------------------------------------
  type BaseRow = { id: string; username: string; role: string; display_name: string | null; totp_enabled: number; expires_at: number; share_id: string | null; locked_at: number | null };
  let base: BaseRow | null = null;
  try {
    base = await env.DB.prepare(
      `SELECT u.id, u.username, u.role, u.display_name, u.totp_enabled, s.expires_at, s.share_id, s.locked_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`
    ).bind(token).first<BaseRow>();
  } catch {
    // pre-0013 database (sessions.locked_at not there yet) — the same row,
    // the lock column read as 0: sessions keep working, nothing is locked
    base = await env.DB.prepare(
      `SELECT u.id, u.username, u.role, u.display_name, u.totp_enabled, s.expires_at, s.share_id, 0 AS locked_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`
    ).bind(token).first<BaseRow>() ?? null;
  }
  if (!base) return null;
  if (base.expires_at < now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }

  // ---------------------------------------------------------------------------
  //  Stage 2 — share context, fetched separately and defensively. A share
  //  session lives only while its credential does (revoked/expired → the
  //  row is gone → 401 → the shell logs the guest out with an honest
  //  message). While the admin froze the remaining time, expiry checks run
  //  against frozen_at — a frozen share can never time out under the cron.
  //  Databases from before a migration simply get neutral defaults for the
  //  columns they never had (no device cap, no suspension, no freeze).
  // ---------------------------------------------------------------------------
  type ShareRow = {
    id: string; owner_id: string; username: string; label: string | null;
    address_id: string | null; perms: string; expires_at: number | null;
    revoked_at: number | null; suspended_at: number | null; time_frozen: number | null;
    frozen_at: number | null; last_seen_at: number | null; max_devices: number | null;
    guest_note: string | null;
  };
  let sh: ShareRow | null = null;
  let shareAddress: string | null = null;
  if (base.share_id) {
    try {
      sh = await env.DB.prepare(
        `SELECT id, owner_id, username, label, address_id, perms, expires_at, revoked_at,
                suspended_at, time_frozen, frozen_at, last_seen_at, max_devices, guest_note
           FROM share_links WHERE id = ?`
      ).bind(base.share_id).first<ShareRow>() ?? null;
    } catch {
      // an older share_links shape (pre-0011/0012 columns) — fall back to the
      // base set the first share release (0009) already had
      try {
        sh = await env.DB.prepare(
          `SELECT id, owner_id, username, label, address_id, perms, expires_at, revoked_at, last_seen_at
             FROM share_links WHERE id = ?`
        ).bind(base.share_id).first<ShareRow>() ?? null;
        if (sh) {
          sh.suspended_at = null;
          sh.time_frozen = 0;
          sh.frozen_at = null;
          sh.max_devices = 0;
          sh.guest_note = null;
        }
      } catch { sh = null; }
    }
    if (sh) {
      try {
        const a = await env.DB.prepare('SELECT address FROM addresses WHERE id = ?').bind(sh.address_id ?? '').first<{ address: string }>();
        shareAddress = a?.address ?? null;
      } catch { /* the primary mailbox line stays empty */ }
    }
  }

  if (base.share_id) {
    const flags = { suspended_at: sh?.suspended_at ?? null, time_frozen: sh?.time_frozen ?? 0, frozen_at: sh?.frozen_at ?? null, expires_at: sh?.expires_at ?? null };
    if (!sh?.username || sh.revoked_at || shareExpired(flags)) {
      await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      return null;
    }
    // live audit: “last seen” moves at most once a minute — a heartbeat, not
    // a write per request
    if (!sh.last_seen_at || now() - sh.last_seen_at > 60_000) {
      try { await env.DB.prepare('UPDATE share_links SET last_seen_at = ? WHERE id = ?').bind(now(), sh.id).run(); } catch { /* never block auth */ }
    }
    // the mailbox set lives in the junction (0010) — a database the migration
    // has not reached yet falls back to the primary column alone
    let shareAddrIds: string[] = [];
    let shareAddrs: string[] = [];
    try {
      const jn = await env.DB.prepare(
        `SELECT sa.address_id, a.address FROM share_addresses sa
           JOIN addresses a ON a.id = sa.address_id
          WHERE sa.share_id = ? ORDER BY a.created_at`
      ).bind(sh.id).all<{ address_id: string; address: string }>();
      if (jn.results?.length) {
        shareAddrIds = jn.results.map((x) => x.address_id);
        shareAddrs = jn.results.map((x) => x.address);
      } else if (sh.address_id) {
        // junction empty but a primary exists (or the junction is missing):
        // repair the junction silently so the guest keeps seeing their mailbox
        try { await env.DB.prepare('INSERT OR IGNORE INTO share_addresses (share_id, address_id) VALUES (?, ?)').bind(sh.id, sh.address_id).run(); } catch { /* pre-0010 database */ }
      }
    } catch { /* pre-0010 database keeps answering with the primary column */ }
    if (!shareAddrIds.length && sh.address_id) {
      shareAddrIds = [sh.address_id];
      if (shareAddress) shareAddrs = [shareAddress];
    }
    const share: ShareInfo = {
      id: sh.id,
      username: sh.username,
      label: sh.label,
      address_id: shareAddrIds[0] ?? sh.address_id ?? '',
      address: shareAddrs[0] ?? shareAddress ?? '',
      address_ids: shareAddrIds,
      addresses: shareAddrs,
      owner_id: sh.owner_id,
      perms: (sh.perms ?? 'read').split(',').map((p) => p.trim()).filter(Boolean),
      max_devices: Number(sh.max_devices ?? 0) || 0,
      note: sh.guest_note ?? null,
      expires_at: sh.expires_at,
      suspended: shareSuspended(flags, shareAddrIds),
      time_frozen: !!(sh.time_frozen && sh.frozen_at),
      frozen_at: sh.time_frozen && sh.frozen_at ? Number(sh.frozen_at) : null,
    };
    return { id: base.id, username: sh.username, role: 'share', display_name: sh.label ?? sh.username, totp_enabled: 0, locked: false, share };
  }

  return { id: base.id, username: base.username, role: base.role, display_name: base.display_name, totp_enabled: base.totp_enabled, locked: !base.share_id && (base.locked_at ?? 0) > 0 };
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

// middleware: the owner only — a share guest must never reach account-level
// surfaces (password change, 2FA, addresses, vault, folders of other rooms)
export async function requireOwner(c: Context, next: Next) {
  const user = c.get('user') as SessionUser | null;
  if (!user) return c.json({ ok: false, error: 'unauthorized' }, 401);
  if (user.role === 'share') return c.json({ ok: false, error: 'forbidden' }, 403);
  await next();
}

// middleware (v3.1.0): a SUSPENDED share is frozen for real — the admin pulled
// the credential's hand. The shell still answers /api/auth/me (so the frozen
// page can paint its honest message) and /api/auth/logout, but every data
// surface — mail, vault, folders, addresses, send — refuses at the API itself.
// Before this, suspension was a client-side flag: a guest with devtools could
// read its mailboxes anyway. Not anymore.
export async function blockSuspendedShare(c: Context, next: Next) {
  const user = c.get('user') as SessionUser | null;
  if (user?.role === 'share' && user.share?.suspended) {
    return c.json({ ok: false, error: 'suspended_share' }, 403);
  }
  await next();
}

// permission check for share sessions — the owner always passes.
// Fail-CLOSED (v3.1.0): a share session without a resolvable share context
// grants NOTHING — the safe default, never the permissive one.
export function shareCan(u: SessionUser | null | undefined, perm: string): boolean {
  if (!u) return false;
  if (u.role !== 'share') return true;
  if (!u.share) return false;
  return u.share.perms.includes(perm);
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
