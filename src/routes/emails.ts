// Cmail — emails: list, read, notes, bulk ops, compose/send
import { Hono } from 'hono';
import type { Env, AppEnv, SessionUser } from '../util';
import { uid, now, clean, getSetting } from '../util';
import { requireUser, } from '../auth';
import { sendViaProvider } from '../emailout';

const app = new Hono<AppEnv>();

const LIST_FIELDS = 'e.id, e.address_id, e.from_name, e.from_addr, e.to_addr, e.subject, e.preview, e.size, e.is_read, e.starred, e.has_note, e.received_at, a.address, a.label AS address_label, a.kind AS address_kind';

// list (per user, filters)
app.get('/', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const q = c.req.query();
  const addressId = q.address_id ?? '';
  const box = q.box ?? 'inbox'; // inbox | starred | noted | unread
  const search = (q.q ?? '').trim();
  const limit = Math.min(100, Math.max(10, parseInt(q.limit ?? '50', 10)));
  const offset = Math.max(0, parseInt(q.offset ?? '0', 10));

  const where: string[] = ['e.user_id = ?'];
  const binds: unknown[] = [u.id];
  if (addressId) { where.push('e.address_id = ?'); binds.push(addressId); }
  if (box === 'starred') where.push('e.starred = 1');
  if (box === 'unread') where.push('e.is_read = 0');
  if (box === 'noted') where.push('e.has_note = 1');
  if (search) {
    where.push('(e.subject LIKE ? OR e.from_addr LIKE ? OR e.from_name LIKE ? OR e.preview LIKE ?)');
    const like = `%${search}%`;
    binds.push(like, like, like, like);
  }

  const sql = `SELECT ${LIST_FIELDS} FROM emails e JOIN addresses a ON a.id = e.address_id
     WHERE ${where.join(' AND ')} ORDER BY e.received_at DESC LIMIT ${limit} OFFSET ${offset}`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();

  const cntSql = `SELECT COUNT(*) AS n FROM emails e WHERE ${where.join(' AND ')}`;
  const total = await c.env.DB.prepare(cntSql).bind(...binds).first<{ n: number }>();

  return c.json({ ok: true, emails: results ?? [], total: total?.n ?? 0, limit, offset });
});

// stats for dashboard badges
app.get('/stats', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const [total, unread, starred, noted, addresses] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM emails WHERE user_id = ?').bind(u.id).first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM emails WHERE user_id = ? AND is_read = 0').bind(u.id).first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM emails WHERE user_id = ? AND starred = 1').bind(u.id).first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM emails WHERE user_id = ? AND has_note = 1').bind(u.id).first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?').bind(u.id).first<{ n: number }>(),
  ]);
  return c.json({
    ok: true,
    stats: {
      total: total?.n ?? 0, unread: unread?.n ?? 0, starred: starred?.n ?? 0,
      noted: noted?.n ?? 0, addresses: addresses?.n ?? 0,
    },
  });
});

// full message (marks as read)
app.get('/:id', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  const email = await c.env.DB.prepare(
    `SELECT e.*, a.address, a.label AS address_label FROM emails e JOIN addresses a ON a.id = e.address_id
     WHERE e.id = ? AND e.user_id = ?`
  ).bind(id, u.id).first<Record<string, unknown>>();
  if (!email) return c.json({ ok: false, error: 'not_found' }, 404);

  const atts = await c.env.DB.prepare(
    'SELECT id, filename, content_type, size, (content_b64 IS NOT NULL) AS available FROM attachments WHERE email_id = ?'
  ).bind(id).all();
  const note = await c.env.DB.prepare('SELECT body, color, pinned, updated_at FROM email_notes WHERE email_id = ?').bind(id).first();

  if (!email.is_read) await c.env.DB.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').bind(id).run();
  return c.json({ ok: true, email: { ...email, is_read: 1 }, attachments: atts.results ?? [], note: note ?? null });
});

// single field toggles
app.patch('/:id', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  const body = await c.req.json<{ is_read?: boolean; starred?: boolean }>().catch(() => null);
  const own = await c.env.DB.prepare('SELECT id FROM emails WHERE id = ? AND user_id = ?').bind(id, u.id).first();
  if (!own) return c.json({ ok: false, error: 'not_found' }, 404);
  if (body?.is_read !== undefined) await c.env.DB.prepare('UPDATE emails SET is_read = ? WHERE id = ?').bind(body.is_read ? 1 : 0, id).run();
  if (body?.starred !== undefined) await c.env.DB.prepare('UPDATE emails SET starred = ? WHERE id = ?').bind(body.starred ? 1 : 0, id).run();
  return c.json({ ok: true });
});

app.delete('/:id', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM emails WHERE id = ? AND user_id = ?').bind(id, u.id).run();
  return c.json({ ok: true });
});

// bulk actions
app.post('/bulk', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const body = await c.req.json<{ ids?: string[]; action?: string }>().catch(() => null);
  const ids = (body?.ids ?? []).slice(0, 500);
  const action = body?.action ?? '';
  if (!ids.length) return c.json({ ok: false, error: 'no_ids' }, 400);
  const ph = ids.map(() => '?').join(',');
  switch (action) {
    case 'read': await c.env.DB.prepare(`UPDATE emails SET is_read = 1 WHERE user_id = ? AND id IN (${ph})`).bind(u.id, ...ids).run(); break;
    case 'unread': await c.env.DB.prepare(`UPDATE emails SET is_read = 0 WHERE user_id = ? AND id IN (${ph})`).bind(u.id, ...ids).run(); break;
    case 'star': await c.env.DB.prepare(`UPDATE emails SET starred = 1 WHERE user_id = ? AND id IN (${ph})`).bind(u.id, ...ids).run(); break;
    case 'unstar': await c.env.DB.prepare(`UPDATE emails SET starred = 0 WHERE user_id = ? AND id IN (${ph})`).bind(u.id, ...ids).run(); break;
    case 'delete': await c.env.DB.prepare(`DELETE FROM emails WHERE user_id = ? AND id IN (${ph})`).bind(u.id, ...ids).run(); break;
    default: return c.json({ ok: false, error: 'unknown_action' }, 400);
  }
  return c.json({ ok: true });
});

// ---------- notes (annotations on emails) ----------

app.put('/:id/note', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  const body = await c.req.json<{ body?: string; color?: string; pinned?: boolean }>().catch(() => null);
  const own = await c.env.DB.prepare('SELECT id FROM emails WHERE id = ? AND user_id = ?').bind(id, u.id).first();
  if (!own) return c.json({ ok: false, error: 'not_found' }, 404);
  const text = typeof body?.body === 'string' ? body.body.slice(0, 10_000) : '';
  const color = ['amber', 'mint', 'sky', 'rose', 'violet'].includes(body?.color ?? '') ? body!.color : 'amber';
  if (!text.trim()) {
    await c.env.DB.prepare('DELETE FROM email_notes WHERE email_id = ?').bind(id).run();
    await c.env.DB.prepare('UPDATE emails SET has_note = 0 WHERE id = ?').bind(id).run();
    return c.json({ ok: true, note: null });
  }
  await c.env.DB.prepare(
    `INSERT INTO email_notes (email_id, user_id, body, color, pinned, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email_id) DO UPDATE SET body = excluded.body, color = excluded.color, pinned = excluded.pinned, updated_at = excluded.updated_at`
  ).bind(id, u.id, text, color, body?.pinned ? 1 : 0, now()).run();
  await c.env.DB.prepare('UPDATE emails SET has_note = 1 WHERE id = ?').bind(id).run();
  return c.json({ ok: true, note: { email_id: id, body: text, color, pinned: !!body?.pinned, updated_at: now() } });
});

// ---------- attachments ----------

app.get('/attachment/:attId', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const attId = c.req.param('attId');
  const row = await c.env.DB.prepare(
    `SELECT at.filename, at.content_type, at.content_b64, at.email_id FROM attachments at
     JOIN emails e ON e.id = at.email_id WHERE at.id = ? AND e.user_id = ?`
  ).bind(attId, u.id).first<{ filename: string; content_type: string; content_b64: string | null; email_id: string }>();
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);
  if (!row.content_b64) return c.json({ ok: false, error: 'attachment_too_large' }, 413);
  const buf = Uint8Array.from(atob(row.content_b64), (ch) => ch.charCodeAt(0));
  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'content-type': row.content_type || 'application/octet-stream',
      'content-disposition': `attachment; filename="${(row.filename || 'attachment').replace(/[^\w.\- ]/g, '_')}"`,
    },
  });
});

// ---------- compose / send ----------

app.post('/send', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const body = await c.req.json<{ from_address_id?: string; to?: string; subject?: string; text?: string; html?: string }>().catch(() => null);
  const to = clean(body?.to, 120);
  const subject = clean(body?.subject, 200) || '(no subject)';
  const text = typeof body?.text === 'string' ? body.text.slice(0, 100_000) : '';
  const html = typeof body?.html === 'string' ? body.html.slice(0, 300_000) : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return c.json({ ok: false, error: 'invalid_recipient' }, 400);
  if (!text && !html) return c.json({ ok: false, error: 'empty_body' }, 400);

  const from = await c.env.DB.prepare('SELECT address FROM addresses WHERE id = ? AND user_id = ?')
    .bind(body?.from_address_id ?? '', u.id).first<{ address: string }>();
  if (!from) return c.json({ ok: false, error: 'invalid_sender' }, 400);

  const provider = (await getSetting(c.env, 'sending_provider')) ?? 'none';
  if (provider === 'none') return c.json({ ok: false, error: 'sending_not_configured' }, 409);

  const res = await sendViaProvider(c.env, { to, subject, text, html, replyTo: from.address });
  if (!res.ok) return c.json({ ok: false, error: 'send_failed', detail: res.error }, 502);
  return c.json({ ok: true });
});

export default app;
