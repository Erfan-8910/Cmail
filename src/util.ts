// Cmail — shared utilities
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_SECRET?: string;
  APP_VERSION?: string;
};

export type SessionUser = {
  id: string;
  username: string;
  role: string;
  display_name: string | null;
  totp_enabled: number;
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

export function passwordStrong(p: string): boolean {
  return typeof p === 'string' && p.length >= 8 && p.length <= 128;
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

export async function hashPassword(password: string): Promise<string> {
  const iterations = 100_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${b64.encode(salt)}$${b64.encode(key)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iterStr, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'pbkdf2') return false;
    const salt = b64.decode(saltB64);
    const key = await pbkdf2(password, salt, parseInt(iterStr, 10));
    // timing-safe-ish compare
    const a = b64.encode(key);
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
