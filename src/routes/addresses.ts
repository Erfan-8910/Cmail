// Cmail — mailbox addresses (permanent + temporary) & domains
import { Hono } from 'hono';
import type { Env, AppEnv, SessionUser } from '../util';
import {
  uid, now, clean, RE_LOCAL_PART, RE_DOMAIN, randomLocalPart, getSetting,
} from '../util';
import { requireUser, requireAdmin, } from '../auth';

const app = new Hono<AppEnv>();

// ---------- domains ----------

app.get('/domains', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const admin = u.role === 'admin';
  const { results } = admin
    ? await c.env.DB.prepare('SELECT * FROM domains ORDER BY created_at DESC').all<{ id: string; name: string; label: string | null; active: number; catch_all: number; created_at: number }>()
    : await c.env.DB.prepare('SELECT id, name, label FROM domains WHERE active = 1 ORDER BY created_at').all<{ id: string; name: string; label: string | null }>();
  const counts = await c.env.DB.prepare(
    `SELECT d.id, COUNT(a.id) AS n FROM domains d LEFT JOIN addresses a ON a.domain_id = d.id GROUP BY d.id`
  ).all<{ id: string; n: number }>();
  const countMap = new Map((counts.results ?? []).map((r) => [r.id, r.n]));
  return c.json({ ok: true, domains: (results ?? []).map((d) => ({ ...d, address_count: countMap.get(d.id) ?? 0 })) });
});

app.post('/domains', requireAdmin, async (c) => {
  const body = await c.req.json<{ name?: string; label?: string; catch_all?: boolean }>().catch(() => null);
  const name = (body?.name ?? '').toLowerCase().trim();
  if (!RE_DOMAIN.test(name)) return c.json({ ok: false, error: 'invalid_domain' }, 400);
  const exists = await c.env.DB.prepare('SELECT id FROM domains WHERE name = ?').bind(name).first();
  if (exists) return c.json({ ok: false, error: 'domain_exists' }, 409);
  const id = uid('dom_');
  await c.env.DB.prepare('INSERT INTO domains (id, name, label, catch_all, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, name, clean(body?.label, 80) || null, body?.catch_all === false ? 0 : 1, now()).run();
  return c.json({ ok: true, domain: { id, name } });
});

app.patch('/domains/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ label?: string; active?: boolean; catch_all?: boolean }>().catch(() => null);
  const dom = await c.env.DB.prepare('SELECT id FROM domains WHERE id = ?').bind(id).first();
  if (!dom) return c.json({ ok: false, error: 'not_found' }, 404);
  if (body?.label !== undefined) await c.env.DB.prepare('UPDATE domains SET label = ? WHERE id = ?').bind(clean(body.label, 80) || null, id).run();
  if (body?.active !== undefined) await c.env.DB.prepare('UPDATE domains SET active = ? WHERE id = ?').bind(body.active ? 1 : 0, id).run();
  if (body?.catch_all !== undefined) await c.env.DB.prepare('UPDATE domains SET catch_all = ? WHERE id = ?').bind(body.catch_all ? 1 : 0, id).run();
  return c.json({ ok: true });
});

app.delete('/domains/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM domains WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// ---------- addresses ----------

app.get('/', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.address, a.label, a.kind, a.expires_at, a.forward_to, a.notes, a.created_at, a.last_mail_at, d.name AS domain,
       (SELECT COUNT(*) FROM emails e WHERE e.address_id = a.id AND e.is_read = 0) AS unread,
       (SELECT COUNT(*) FROM emails e WHERE e.address_id = a.id) AS total
     FROM addresses a LEFT JOIN domains d ON d.id = a.domain_id
     WHERE a.user_id = ? ORDER BY a.created_at DESC`
  ).bind(u.id).all();
  return c.json({ ok: true, addresses: results ?? [] });
});

app.post('/', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const body = await c.req.json<{ local?: string; domain?: string; kind?: string; ttl_hours?: number; label?: string; notes?: string }>().catch(() => null);

  const kind = body?.kind === 'temp' ? 'temp' : 'permanent';
  const domainName = (body?.domain ?? '').toLowerCase().trim();
  const domain = await c.env.DB.prepare('SELECT id, name, active FROM domains WHERE name = ?').bind(domainName)
    .first<{ id: string; name: string; active: number }>();
  if (!domain || !domain.active) return c.json({ ok: false, error: 'invalid_domain' }, 400);

  let local = (body?.local ?? '').toLowerCase().trim();
  if (local === '__random__' || !local) local = randomLocalPart();
  if (!RE_LOCAL_PART.test(local)) return c.json({ ok: false, error: 'invalid_local_part' }, 400);

  // address cap per user
  const cap = parseInt((await getSetting(c.env, 'max_addresses')) ?? '50', 10) || 50;
  const cnt = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?').bind(u.id).first<{ n: number }>();
  if ((cnt?.n ?? 0) >= cap) return c.json({ ok: false, error: 'address_limit' }, 409);

  const address = `${local}@${domain.name}`;
  const exists = await c.env.DB.prepare('SELECT id FROM addresses WHERE address = ?').bind(address).first();
  if (exists) return c.json({ ok: false, error: 'address_taken' }, 409);

  let expiresAt: number | null = null;
  if (kind === 'temp') {
    const ttl = Math.min(8760, Math.max(1, body?.ttl_hours ?? (parseInt((await getSetting(c.env, 'temp_ttl_default')) ?? '24', 10) || 24)));
    expiresAt = now() + ttl * 3600_000;
  }

  const id = uid('adr_');
  await c.env.DB.prepare(
    'INSERT INTO addresses (id, user_id, domain_id, address, label, notes, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, u.id, domain.id, address, clean(body?.label, 80) || null, clean(body?.notes, 4000) || '', kind, expiresAt, now()).run();

  return c.json({ ok: true, address: { id, address, kind, expires_at: expiresAt, label: clean(body?.label, 80) || null } });
});

app.patch('/:id', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  const addr = await c.env.DB.prepare('SELECT id, user_id, kind, expires_at FROM addresses WHERE id = ? AND user_id = ?')
    .bind(id, u.id).first<{ id: string; user_id: string; kind: string; expires_at: number | null }>();
  if (!addr) return c.json({ ok: false, error: 'not_found' }, 404);

  const body = await c.req.json<{ label?: string; forward_to?: string; extend_hours?: number; notes?: string }>().catch(() => null);
  if (body?.label !== undefined) await c.env.DB.prepare('UPDATE addresses SET label = ? WHERE id = ?').bind(clean(body.label, 80) || null, id).run();
  if (body?.notes !== undefined) await c.env.DB.prepare('UPDATE addresses SET notes = ? WHERE id = ?').bind(clean(body.notes, 4000) ?? '', id).run();

  if (body?.forward_to !== undefined) {
    const fwd = clean(body.forward_to, 120);
    if (fwd && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fwd)) return c.json({ ok: false, error: 'invalid_email' }, 400);
    await c.env.DB.prepare('UPDATE addresses SET forward_to = ? WHERE id = ?').bind(fwd || null, id).run();
  }

  if (body?.extend_hours && addr.kind === 'temp') {
    const base = Math.max(now(), addr.expires_at ?? now());
    const hours = Math.min(8760, Math.max(1, body.extend_hours));
    await c.env.DB.prepare('UPDATE addresses SET expires_at = ? WHERE id = ?').bind(base + hours * 3600_000, id).run();
  }
  return c.json({ ok: true });
});

// delete an address (its emails cascade)
app.delete('/:id', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').bind(id, u.id).run();
  return c.json({ ok: true });
});

// empty an inbox
app.post('/:id/purge', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  const addr = await c.env.DB.prepare('SELECT id FROM addresses WHERE id = ? AND user_id = ?').bind(id, u.id).first();
  if (!addr) return c.json({ ok: false, error: 'not_found' }, 404);
  await c.env.DB.prepare('DELETE FROM emails WHERE address_id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default app;
