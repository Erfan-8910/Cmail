// Cmail — shared utilities
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type Env = {
  // D1 — the ONLY binding Cmail needs. If a deployment ships without it the
  // diagnostics layer answers with setup guidance instead of a raw 500.
  DB: D1Database;
  APP_SECRET?: string;
  APP_VERSION?: string;
};

// share-session context — rides on SessionUser when the signed-in browser is
// a guest credential: one permission list, and since v3.0.0 a SET of mailboxes
// (address_ids/addresses carry the full set; address_id/address stay as the
// primary first mailbox so older code paths keep answering)
export type ShareInfo = {
  id: string;
  username: string;
  label: string | null;
  address_id: string;
  address: string;
  address_ids: string[];
  addresses: string[];
  owner_id: string;
  perms: string[];
  max_devices: number;
  note: string | null;
  expires_at: number | null;
  // lifecycle (v3.0.0 r6): suspension is manual flag OR "no mailbox assigned";
  // time_frozen/frozen_at let the remaining subscription time stand still
  // while the share is suspended
  suspended: boolean;
  time_frozen: boolean;
  frozen_at: number | null;
};

export type SessionUser = {
  id: string;
  username: string;
  role: string;
  display_name: string | null;
  totp_enabled: number;
  share?: ShareInfo;
};

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser | null } };

export const uid = (prefix = ''): string =>
  prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 20);

export const now = (): number => Date.now();

export const randomToken = (bytes = 32): string => {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const b64 = {
  encode(buf: ArrayBuffer | Uint8Array): string {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  },
  decode(str: string): Uint8Array {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  },
};

export const str = {
  toBuf(s: string): Uint8Array { return new TextEncoder().encode(s); },
  fromBuf(buf: ArrayBuffer | Uint8Array): string {
    return new TextDecoder().decode(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  },
};

export function jsonError(c: Context, status: number, code: string, message?: string) {
  return c.json({ ok: false, error: code, message: message ?? code }, status as ContentfulStatusCode);
}

export function jsonOk(c: Context, data: Record<string, unknown> = {}) {
  return c.json({ ok: true, ...data });
}

// ---------- validation ----------

export const RE_LOCAL_PART = /^[a-z0-9]([a-z0-9._-]{0,30})[a-z0-9]$/i;
export const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const RE_DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export function clean(s: unknown, max = 255): string {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, max);
}

export function usernameValid(u: string): boolean {
  return /^[a-zA-Z0-9_.-]{3,32}$/.test(u);
}

// ---------- password policy (v3.1.0) ----------
//
// The bar is decided HERE, on the server — the client meter is only a mirror.
// Every password-setting route (first admin, panel change, admin reset, share
// create/regenerate) calls this same function, so no client-side bypass can
// sneak a weak credential past it:
//   - 8..128 characters
//   - at least one letter (any language — Persian included) and one digit
//   - never a top-common password, never a single repeated character
export const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234',
  'passw0rd', 'p@ssw0rd', 'p@ssword1', 'letmein', 'letmein1', 'letmein123',
  'welcome', 'welcome1', 'welcome123', 'admin', 'admin123', 'admin1234',
  'qwerty123', 'qwerty1234', 'qwertyuiop1', '1q2w3e4r', '1q2w3e4r5t',
  'qazwsx123', 'zaq12wsx', 'asdf1234', 'asdfghjk', 'asdfgh123',
  'iloveyou', 'iloveyou1', 'monkey123', 'dragon123', 'sunshine1',
  'princess1', 'football1', 'baseball1', 'master123', 'michael1',
  'abcd1234', 'abc12345', '12345678', '123456789', '1234567890',
  '11223344', '11111111', '00000000', '12121212', '12341234',
  '88888888', '12131415', 'iran12345', 'iran1400', 'cmail2026',
  'recover2026', 'recovercmail', 'recover-cmail', 'recover-cmail-2026',
  'recovercmail2026', 'recover-cmail2026', 'recover2026!', 'recovery2026',
]);

export function passwordStrong(p: string): boolean {
  if (typeof p !== 'string' || p.length < 8 || p.length > 128) return false;
  // one letter (any alphabet) + one digit — Unicode-aware so a Persian
  // passphrase passes exactly like a Latin one
  if (!/\p{L}/u.test(p)) return false;
  if (!/\p{N}/u.test(p)) return false;
  // eight+ identical characters anywhere in the string — aaaaaaaaaa1 is junk,
  // even though the trailing digit flatters the letter+digit rule
  if (/(.)\1{7,}/u.test(p)) return false;
  const low = p.toLowerCase();
  const flat = low.replace(/[\s._-]/g, '');
  if (WEAK_PASSWORDS.has(low) || WEAK_PASSWORDS.has(flat)) return false;
  return true;
}

// ---------- settings store ----------

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(key, value).run();
}

export async function getSettings(env: Env, keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!keys.length) return out;
  const ph = keys.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${ph})`)
    .bind(...keys).all<{ key: string; value: string }>();
  for (const r of results ?? []) out[r.key] = r.value;
  return out;
}

// Application secret used for AES key derivation (TOTP encryption, tokens).
export async function appSecret(env: Env): Promise<string> {
  if (env.APP_SECRET && env.APP_SECRET.length >= 16) return env.APP_SECRET;
  if (!env.DB) throw new Error('D1 binding (DB) is not configured for this Worker');
  let s = await getSetting(env, 'app_secret');
  if (!s) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    s = b64.encode(buf);
    await setSetting(env, 'app_secret', s);
  }
  return s;
}

// ---------- AES-GCM (encrypt TOTP secrets / 2FA secrets at rest) ----------

async function aesKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', str.toBuf(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: str.toBuf('cmail-aes-v1'), info: str.toBuf('totp-seal') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function sealText(env: Env, plain: string): Promise<string> {
  const key = await aesKey(await appSecret(env));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, str.toBuf(plain));
  return 'v1.' + b64.encode(iv) + '.' + b64.encode(ct);
}

export async function openText(env: Env, sealed: string): Promise<string> {
  const [v, ivB, ctB] = sealed.split('.');
  if (v !== 'v1') throw new Error('bad ciphertext');
  const key = await aesKey(await appSecret(env));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.decode(ivB) }, key, b64.decode(ctB));
  return str.fromBuf(pt);
}

// ---------- PBKDF2 password hashing ----------
//
// v3.1.0 — TWO hard ceilings shape this code:
//
// 1. Cloudflare Workers hard-caps PBKDF2 at 100,000 iterations
//    ("Pbkdf2 failed: iteration counts above 100000 are not supported"),
//    so the iteration count is pinned AT the platform maximum — verified
//    live against a real deployment.
//
// 2. Iterations alone cannot stop an offline cracker who holds the D1 rows.
//    So every NEW hash is PEPPERED: the PBKDF2 output is HMAC'd with a key
//    derived from APP_SECRET — which lives in Worker Secrets (or, at worst,
//    the D1 settings row). On installs where APP_SECRET is a real secret
//    (deploy.sh sets it), a leaked database alone can no longer verify a
//    single password guess. Format: pbkdf2mac$<iters>$<salt>$<hmac>.
//    Legacy plain pbkdf2$… hashes still verify, and every successful
//    sign-in transparently re-hashes them to the peppered form.

const PBKDF2_CEILING = 100_000; // Cloudflare's hard cap — do not raise

export function pbkdf2Target(env?: Env): number {
  const raw = parseInt(String((env as { PBKDF2_ITERATIONS?: string })?.PBKDF2_ITERATIONS ?? ''), 10);
  if (!Number.isFinite(raw)) return PBKDF2_CEILING;
  // the override may only go DOWN (10k floor) — never above the platform cap
  return Math.min(PBKDF2_CEILING, Math.max(10_000, raw));
}

// the pepper key: HKDF from the application secret (Worker Secret on real
// installs), independent from the AES key that seals TOTP secrets
async function pepperKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', str.toBuf(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: str.toBuf('cmail-pepper-v1'), info: str.toBuf('password-mac') },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign']
  );
}

export async function hashPassword(env: Env, password: string): Promise<string> {
  const iterations = pbkdf2Target(env);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await pbkdf2(password, salt, iterations);
  const mac = await crypto.subtle.sign('HMAC', await pepperKey(await appSecret(env)), key);
  return `pbkdf2mac$${iterations}$${b64.encode(salt)}$${b64.encode(new Uint8Array(mac))}`;
}

// worth re-hashing: anything that is not the current peppered form at the
// current iteration floor (ancient plain hashes, low-iteration hashes)
export function needsRehash(stored: string, env?: Env): boolean {
  try {
    const [scheme, iterStr] = stored.split('$');
    if (scheme !== 'pbkdf2mac') return true;
    return (parseInt(iterStr, 10) || 0) < pbkdf2Target(env);
  } catch {
    return false;
  }
}

export async function verifyPassword(env: Env, password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iterStr, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'pbkdf2' && scheme !== 'pbkdf2mac') return false;
    const salt = b64.decode(saltB64);
    const key = await pbkdf2(password, salt, parseInt(iterStr, 10));
    // peppered scheme: the PBKDF2 output never touches the database — the
    // stored value is its HMAC under the app secret
    let a: string;
    if (scheme === 'pbkdf2mac') {
      const mac = await crypto.subtle.sign('HMAC', await pepperKey(await appSecret(env)), key);
      a = b64.encode(new Uint8Array(mac));
    } else {
      a = b64.encode(key);
    }
    if (a.length !== hashB64.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ hashB64.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const base = await crypto.subtle.importKey('raw', str.toBuf(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
}

// ---------- misc ----------

export function previewOf(text: string | null | undefined, len = 160): string {
  if (!text) return '';
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > len ? t.slice(0, len) + '…' : t;
}

export function randomLocalPart(): string {
  const words = ['swift', 'quiet', 'amber', 'noble', 'crimson', 'velvet', 'orbit', 'lunar', 'cobalt', 'ember', 'zephyr', 'onyx', 'delta', 'harbor', 'echo', 'atlas', 'raven', 'cinder', 'frost', 'sable'];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = Math.random().toString(36).slice(2, 8);
  return `${w}.${n}`;
}

// ---------- share lifecycle (v3.0.0 r6) ----------
//
// Suspension has exactly two sources, both honest:
//   1. manual  — the admin suspended the share by hand (suspended_at stamp);
//   2. derived — the admin has NOT assigned any mailbox to the credential
//      (empty junction). Assigning mailboxes again (تنظیم مجدد) returns the
//      share to normal with no flag to flip. An inbox that is merely empty
//      of MAIL never suspends anything — mail content is not the admin's
//      assignment decision.
// The credential still works and the guest still signs in either way — the
// frozen page answers instead of an inbox.

export type ShareFlags = {
  suspended_at?: number | null;
  time_frozen?: number | null;
  frozen_at?: number | null;
  expires_at?: number | null;
};

// while the countdown is frozen, "now" for every expiry check is frozen_at —
// a frozen share can never expire under the cron, and the remaining time it
// advertises is a constant
export function shareEffectiveNow(s: ShareFlags): number {
  return s.time_frozen && s.frozen_at ? Number(s.frozen_at) : Date.now();
}

export function shareExpired(s: ShareFlags): boolean {
  if (!s.expires_at) return false;
  return Number(s.expires_at) < shareEffectiveNow(s);
}

export function shareNoMailbox(addressIds: (string | null | undefined)[] | null | undefined): boolean {
  return !(addressIds ?? []).filter(Boolean).length;
}

export function shareSuspended(s: ShareFlags, addressIds: (string | null | undefined)[] | null | undefined): boolean {
  return !!s.suspended_at || shareNoMailbox(addressIds);
}

// remaining subscription time in ms (null = no limit at all)
export function shareRemainingMs(s: ShareFlags): number | null {
  if (!s.expires_at) return null;
  return Number(s.expires_at) - shareEffectiveNow(s);
}
