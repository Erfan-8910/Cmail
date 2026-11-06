// Cmail — TOTP vault: named 2FA code entries with live generation
import { Hono } from 'hono';
import { renderSVG } from 'uqr';
import type { Env, AppEnv, SessionUser } from '../util';
import { uid, now, clean, sealText, openText } from '../util';
import { requireUser, } from '../auth';
import { totp, totpRemaining, parseOtpauthUri, normalizeSecret, verifyTotp } from '../totp';

const app = new Hono<AppEnv>();

type Entry = {
  id: string; name: string; issuer: string | null; secret_enc: string;
  algo: string; digits: number; period: number; color: string | null; sort: number;
  icon: string | null; address_id: string | null; folder_id: string | null;
};

// ---------- folders (user-managed groups of keys, scoped to ONE account) ----------

// list folders with entry counts; ?address_id= scopes to one mailbox —
// a folder never bridges two accounts
app.get('/folders', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const scope = (c.req.query('address_id') ?? '').trim();
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.name, f.icon, f.color, f.address_id, f.created_at,
       (SELECT COUNT(*) FROM totp_entries e WHERE e.folder_id = f.id) AS count
     FROM totp_folders f WHERE f.user_id = ? ${scope ? 'AND f.address_id = ?' : ''} ORDER BY f.created_at`
  ).bind(...(scope ? [u.id, scope] : [u.id])).all();
  return c.json({ ok: true, folders: results ?? [] });
});

// create folder — born bound to the account the vault is open on
app.post('/folders', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const body = await c.req.json<{ name?: string; icon?: string; color?: string; address_id?: string }>().catch(() => null);
  const name = clean(body?.name, 40);
  if (!name) return c.json({ ok: false, error: 'name_required' }, 400);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM totp_folders WHERE user_id = ?').bind(u.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= 30) return c.json({ ok: false, error: 'folder_limit' }, 409);
  // the folder is stamped with its account — optional, but once set it must
  // be an address this user owns
  let addressId: string | null = null;
  if (body?.address_id) {
    const own = await c.env.DB.prepare('SELECT id FROM addresses WHERE id = ? AND user_id = ?').bind(body.address_id, u.id).first();
    if (own) addressId = body.address_id;
  }
  const id = uid('fld_');
  await c.env.DB.prepare('INSERT INTO totp_folders (id, user_id, address_id, name, icon, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, u.id, addressId, name, clean(body?.icon, 40) || null, clean(body?.color, 20) || null, now()).run();
  return c.json({ ok: true, folder: { id, name, icon: clean(body?.icon, 40) || null, color: clean(body?.color, 20) || null, address_id: addressId, count: 0 } });
});

// rename / restyle folder
app.patch('/folders/:id', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  const own = await c.env.DB.prepare('SELECT id FROM totp_folders WHERE id = ? AND user_id = ?').bind(id, u.id).first();
  if (!own) return c.json({ ok: false, error: 'not_found' }, 404);
  const body = await c.req.json<{ name?: string; icon?: string; color?: string }>().catch(() => null);
  if (body?.name !== undefined) await c.env.DB.prepare('UPDATE totp_folders SET name = ? WHERE id = ?').bind(clean(body.name, 40) || 'unnamed', id).run();
  if (body?.icon !== undefined) await c.env.DB.prepare('UPDATE totp_folders SET icon = ? WHERE id = ?').bind(clean(body.icon, 40) || null, id).run();
  if (body?.color !== undefined) await c.env.DB.prepare('UPDATE totp_folders SET color = ? WHERE id = ?').bind(clean(body.color, 20) || null, id).run();
  return c.json({ ok: true });
});

// delete folder — its keys stay, they just become ungrouped
app.delete('/folders/:id', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE totp_entries SET folder_id = NULL WHERE folder_id = ? AND user_id = ?').bind(id, u.id).run();
  await c.env.DB.prepare('DELETE FROM totp_folders WHERE id = ? AND user_id = ?').bind(id, u.id).run();
  return c.json({ ok: true });
});

// list entries (no secrets) + fresh code for each; ?address_id= scopes to one mailbox
app.get('/', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const scope = (c.req.query('address_id') ?? '').trim();
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, issuer, algo, digits, period, color, sort, created_at, icon, address_id, folder_id FROM totp_entries
     WHERE user_id = ? ${scope ? 'AND address_id = ?' : ''} ORDER BY sort, created_at`
  ).bind(...(scope ? [u.id, scope] : [u.id])).all<any>();
  const entries = results ?? [];
  const t = Date.now();
  const withCodes = await Promise.all(entries.map(async (e) => {
    try {
      const row = await c.env.DB.prepare('SELECT secret_enc FROM totp_entries WHERE id = ? AND user_id = ?').bind(e.id, u.id)
        .first<{ secret_enc: string }>();
      const secret = await openText(c.env, row!.secret_enc);
      const code = await totp(secret, e.algo, e.digits, e.period, t);
      const remaining = await totpRemaining(e.period, t);
      return { ...e, code, remaining };
    } catch {
      return { ...e, code: null, remaining: e.period };
    }
  }));
  return c.json({ ok: true, entries: withCodes, server_time: t });
});

// live codes only (light polling)
app.get('/codes', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const { results } = await c.env.DB.prepare('SELECT id, algo, digits, period, secret_enc FROM totp_entries WHERE user_id = ?').bind(u.id).all<Entry>();
  const t = Date.now();
  const codes = await Promise.all((results ?? []).map(async (e) => {
    try {
      const secret = await openText(c.env, e.secret_enc);
      return { id: e.id, code: await totp(secret, e.algo, e.digits, e.period, t), remaining: await totpRemaining(e.period, t) };
    } catch { return { id: e.id, code: null, remaining: 0 }; }
  }));
  return c.json({ ok: true, codes, server_time: t });
});

// create
app.post('/', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const body = await c.req.json<{
    name?: string; issuer?: string; secret?: string; uri?: string;
    algo?: string; digits?: number; period?: number; color?: string;
    icon?: string; address_id?: string; folder_id?: string;
  }>().catch(() => null);

  let name = clean(body?.name, 60);
  let issuer = clean(body?.issuer, 60);
  let secret = '';
  let algo = ['SHA1', 'SHA256', 'SHA512'].includes(body?.algo ?? '') ? body!.algo! : 'SHA1';
  let digits = Math.min(8, Math.max(6, body?.digits ?? 6));
  let period = Math.min(120, Math.max(15, body?.period ?? 30));

  if (body?.uri) {
    const cfg = parseOtpauthUri(body.uri.trim());
    if (!cfg) return c.json({ ok: false, error: 'invalid_uri' }, 400);
    secret = cfg.secret;
    name = name || cfg.name || '';
    issuer = issuer || cfg.issuer || '';
    algo = ['SHA1', 'SHA256', 'SHA512'].includes(cfg.algo) ? cfg.algo : algo;
    digits = cfg.digits; period = cfg.period;
  } else {
    secret = normalizeSecret(body?.secret ?? '');
  }
  if (!secret || secret.length < 8) return c.json({ ok: false, error: 'invalid_secret' }, 400);
  if (!name) return c.json({ ok: false, error: 'name_required' }, 400);

  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM totp_entries WHERE user_id = ?').bind(u.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= 100) return c.json({ ok: false, error: 'vault_limit' }, 409);

  const id = uid('tfa_');
  const sealed = await sealText(c.env, secret);
  // optional mailbox link (must belong to this user)
  let addressId: string | null = null;
  if (body?.address_id) {
    const own = await c.env.DB.prepare('SELECT id FROM addresses WHERE id = ? AND user_id = ?').bind(body.address_id, u.id).first();
    if (own) addressId = body.address_id;
  }
  const icon = clean(body?.icon, 40) || null;
  // optional folder (must belong to this user, and to the same account —
  // a folder of account B can never hold the keys of account A)
  let folderId: string | null = null;
  if (body?.folder_id) {
    const fown = await c.env.DB.prepare('SELECT id, address_id FROM totp_folders WHERE id = ? AND user_id = ?').bind(body.folder_id, u.id).first<{ id: string; address_id: string | null }>();
    if (fown && (!fown.address_id || !addressId || fown.address_id === addressId)) folderId = body.folder_id;
  }
  await c.env.DB.prepare(
    'INSERT INTO totp_entries (id, user_id, name, issuer, secret_enc, algo, digits, period, color, sort, created_at, icon, address_id, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, u.id, name, issuer || null, sealed, algo, digits, period, clean(body?.color, 20) || null, (count?.n ?? 0), now(), icon, addressId, folderId).run();

  const code = await totp(secret, algo, digits, period);
  return c.json({ ok: true, entry: { id, name, issuer, algo, digits, period, color: body?.color ?? null, icon, address_id: addressId, code, remaining: await totpRemaining(period) } });
});

// QR code (svg) for exporting an entry
app.get('/:id/qr', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT name, issuer, secret_enc, algo, digits, period FROM totp_entries WHERE id = ? AND user_id = ?')
    .bind(id, u.id).first<{ name: string; issuer: string | null; secret_enc: string; algo: string; digits: number; period: number }>();
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);
  const secret = await openText(c.env, row.secret_enc);
  const label = `${row.issuer ?? 'Cmail'}:${row.name}`;
  const p = new URLSearchParams({ secret, issuer: row.issuer ?? 'Cmail', algorithm: row.algo, digits: String(row.digits), period: String(row.period) });
  const uri = `otpauth://totp/${encodeURIComponent(label)}?${p.toString()}`;
  const svg = renderSVG(uri, { border: 1 });
  return c.body(svg, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
});

// reveal secret (for migration to another app) — sensitive
app.get('/:id/secret', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT secret_enc, name FROM totp_entries WHERE id = ? AND user_id = ?').bind(id, u.id)
    .first<{ secret_enc: string; name: string }>();
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);
  const secret = await openText(c.env, row.secret_enc);
  return c.json({ ok: true, secret, name: row.name });
});

// update
app.patch('/:id', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; issuer?: string; color?: string; sort?: number; icon?: string; address_id?: string | null; folder_id?: string | null }>().catch(() => null);
  const row = await c.env.DB.prepare('SELECT id FROM totp_entries WHERE id = ? AND user_id = ?').bind(id, u.id).first();
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);
  if (body?.name !== undefined) await c.env.DB.prepare('UPDATE totp_entries SET name = ? WHERE id = ?').bind(clean(body.name, 60) || 'unnamed', id).run();
  if (body?.issuer !== undefined) await c.env.DB.prepare('UPDATE totp_entries SET issuer = ? WHERE id = ?').bind(clean(body.issuer, 60) || null, id).run();
  if (body?.color !== undefined) await c.env.DB.prepare('UPDATE totp_entries SET color = ? WHERE id = ?').bind(clean(body.color, 20) || null, id).run();
  if (body?.sort !== undefined) await c.env.DB.prepare('UPDATE totp_entries SET sort = ? WHERE id = ?').bind(Math.max(0, Math.min(9999, body.sort)), id).run();
  if (body?.icon !== undefined) await c.env.DB.prepare('UPDATE totp_entries SET icon = ? WHERE id = ?').bind(clean(body.icon, 40) || null, id).run();
  if (body?.address_id !== undefined) {
    let addressId: string | null = null;
    if (body.address_id) {
      const own = await c.env.DB.prepare('SELECT id FROM addresses WHERE id = ? AND user_id = ?').bind(body.address_id, u.id).first();
      if (own) addressId = body.address_id;
    }
    await c.env.DB.prepare('UPDATE totp_entries SET address_id = ? WHERE id = ?').bind(addressId, id).run();
    // moving a key to another account releases the old account's folder —
    // groupings never follow a key across accounts
    if (addressId) {
      await c.env.DB.prepare(
        'UPDATE totp_entries SET folder_id = NULL WHERE id = ? AND folder_id IS NOT NULL AND folder_id NOT IN (SELECT id FROM totp_folders WHERE address_id = ? OR address_id IS NULL)'
      ).bind(id, addressId).run();
    } else {
      await c.env.DB.prepare(
        'UPDATE totp_entries SET folder_id = NULL WHERE id = ? AND folder_id IS NOT NULL AND folder_id NOT IN (SELECT id FROM totp_folders WHERE address_id IS NULL)'
      ).bind(id).run();
    }
  }
  if (body?.folder_id !== undefined) {
    let folderId: string | null = null;
    if (body.folder_id) {
      // the folder must belong to this user AND to the entry's account
      const addr = await c.env.DB.prepare('SELECT address_id FROM totp_entries WHERE id = ? AND user_id = ?').bind(id, u.id).first<{ address_id: string | null }>();
      const fown = await c.env.DB.prepare('SELECT id, address_id FROM totp_folders WHERE id = ? AND user_id = ?').bind(body.folder_id, u.id).first<{ id: string; address_id: string | null }>();
      if (fown && (!fown.address_id || !addr?.address_id || fown.address_id === addr.address_id)) folderId = body.folder_id;
    }
    await c.env.DB.prepare('UPDATE totp_entries SET folder_id = ? WHERE id = ?').bind(folderId, id).run();
  }
  return c.json({ ok: true });
});

app.delete('/:id', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM totp_entries WHERE id = ? AND user_id = ?').bind(id, u.id).run();
  return c.json({ ok: true });
});

// verify a code against an entry (handy when double-checking)
app.post('/:id/verify', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  const body = await c.req.json<{ code?: string }>().catch(() => null);
  const row = await c.env.DB.prepare('SELECT secret_enc, algo, digits, period FROM totp_entries WHERE id = ? AND user_id = ?')
    .bind(id, u.id).first<{ secret_enc: string; algo: string; digits: number; period: number }>();
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);
  const secret = await openText(c.env, row.secret_enc);
  const valid = await verifyTotp(secret, (body?.code ?? '').trim(), row.algo, row.digits, row.period);
  return c.json({ ok: true, valid });
});

export default app;
