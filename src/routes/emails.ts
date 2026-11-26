// Cmail — emails: list, read, notes, bulk ops, compose/send
import { Hono } from 'hono';
import type { Env, AppEnv, SessionUser } from '../util';
import { uid, now, clean, getSetting } from '../util';
import { requireUser, shareCan, blockSuspendedShare, clientIp, rateLimit } from '../auth';
import { sendViaProvider } from '../emailout';

const app = new Hono<AppEnv>();

// a suspended share is frozen at the API itself (v3.1.0) — the shell paints
// its frozen page from /api/auth/me; every mailbox route refuses here
app.use('*', blockSuspendedShare);

// a share guest sees exactly its shared mailbox set and only what its
// permission list allows — these helpers keep that rule in one place.
// since v3.0.0 the set can hold many mailboxes (junction 0010). An EMPTY set
// (the admin unassigned every mailbox) matches nothing — never the owner's
// whole world, which the raw user_id query alone would answer.
function shareScope(u: SessionUser): string[] | null {
  if (!u.share) return null;
  const ids = (u.share.address_ids?.length ? u.share.address_ids : [u.share.address_id]).filter(Boolean);
  return ids; // may be [] — an unassigned guest
}
function shareAddr(u: SessionUser): string | null { return shareScope(u)?.[0] ?? null; }
const inPh = (ids: string[]) => `(${ids.map(() => '?').join(',')})`;
// scope as a WHERE fragment: null = owner (no filter), [] = guest with no
// mailbox left (matches nothing), otherwise the IN list
function scopeSql(scope: string[] | null, col = 'address_id'): string {
  if (scope === null) return '';
  return scope.length ? ` AND ${col} IN ${inPh(scope)}` : ' AND 1=0';
}

const LIST_FIELDS = 'e.id, e.address_id, e.from_name, e.from_addr, e.to_addr, e.subject, e.preview, e.size, e.is_read, e.starred, e.has_note, e.received_at, e.folder_id, e.direction, e.provider, (EXISTS(SELECT 1 FROM attachments x WHERE x.email_id = e.id)) AS has_att, a.address, a.label AS address_label, a.kind AS address_kind';

// list (per user, filters)
app.get('/', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const q = c.req.query();
  const box = q.box ?? 'inbox'; // inbox | starred | noted | unread
  const search = (q.q ?? '').trim();
  const limit = Math.min(100, Math.max(10, parseInt(q.limit ?? '50', 10)));
  const offset = Math.max(0, parseInt(q.offset ?? '0', 10));

  const where: string[] = ['e.user_id = ?'];
  const binds: unknown[] = [u.id];
  // the guest's world is the shared mailbox set — any other address_id is ignored
  const scope0 = shareScope(u);
  if (scope0 && scope0.length) {
    where.push(`e.address_id IN ${inPh(scope0)}`);
    binds.push(...scope0);
  } else if (scope0) {
    where.push('1=0'); // every mailbox unassigned — an empty honest world
  } else {
    const addressId = q.address_id ?? '';
    if (addressId) { where.push('e.address_id = ?'); binds.push(addressId); }
  }
  if (box === 'starred') where.push('e.starred = 1');
  if (box === 'unread') where.push('e.is_read = 0');
  if (box === 'noted') where.push('e.has_note = 1');
  // box is opt-in — the frontend cuts folders client-side, so the default
  // pull (no box) is All Mail: received and sent together
  if (box === 'sent') where.push("e.direction = 'out'");
  if (search) {
    where.push('(e.subject LIKE ? OR e.from_addr LIKE ? OR e.from_name LIKE ? OR e.preview LIKE ?)');
    const like = `%${search}%`;
    binds.push(like, like, like, like);
  }

  const sql = `SELECT ${LIST_FIELDS} FROM emails e JOIN addresses a ON a.id = e.address_id
     WHERE ${where.join(' AND ')} ORDER BY e.received_at DESC LIMIT ${limit} OFFSET ${offset}`;
  let results: Record<string, unknown>[] | undefined;
  try {
    ({ results } = await c.env.DB.prepare(sql).bind(...binds).all());
  } catch {
    // a database the 0008 migration hasn't reached yet: same list, no direction cut
    const slimFields = LIST_FIELDS.replace(', e.direction, e.provider', '');
    const slimWhere = where.map((w) => w.replace("e.direction = 'out'", '1=1').replace("e.direction != 'out'", '1=1'));
    const slim = `SELECT ${slimFields} FROM emails e JOIN addresses a ON a.id = e.address_id
     WHERE ${slimWhere.join(' AND ')} ORDER BY e.received_at DESC LIMIT ${limit} OFFSET ${offset}`;
    ({ results } = await c.env.DB.prepare(slim).bind(...binds).all());
  }

  // v3.2.2 — the paperclip flag is the truth now (any attachment row exists),
  // not a size guess. A database without the new columns still answers: the
  // fallback below drops the subquery and keeps the old heuristic client-side.
  let hasAtt = false;
  try { hasAtt = (results ?? []).some((r) => r.has_att === 1); } catch { hasAtt = false; }

  const cntSql = `SELECT COUNT(*) AS n FROM emails e WHERE ${where.join(' AND ')}`;
  const total = await c.env.DB.prepare(cntSql).bind(...binds).first<{ n: number }>();

  // a suspended guest (manual suspension, or no mailbox assigned anymore)
  // gets the suspended flag — the shell freezes into the suspended page
  // until the admin unsuspends or re-assigns mailboxes
  const suspended = scope0 ? !!u.share?.suspended : undefined;
  return c.json({ ok: true, emails: results ?? [], total: total?.n ?? 0, limit, offset, has_att_any: hasAtt, ...(suspended !== undefined ? { suspended } : {}) });
});

// stats for dashboard badges
app.get('/stats', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const scope = shareScope(u);
  const escope = scopeSql(scope);
  const eb = scope && scope.length ? [u.id, ...scope] : [u.id];
  const [total, unread, starred, noted, addresses] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM emails WHERE user_id = ?${escope}`).bind(...eb).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM emails WHERE user_id = ? AND is_read = 0${escope}`).bind(...eb).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM emails WHERE user_id = ? AND starred = 1${escope}`).bind(...eb).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM emails WHERE user_id = ? AND has_note = 1${escope}`).bind(...eb).first<{ n: number }>(),
    scope
      ? c.env.DB.prepare(`SELECT COUNT(*) AS n FROM addresses WHERE id IN ${inPh(scope)}`).bind(...scope).first<{ n: number }>()
      : c.env.DB.prepare('SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?').bind(u.id).first<{ n: number }>(),
  ]);
  return c.json({
    ok: true,
    stats: {
      total: total?.n ?? 0, unread: unread?.n ?? 0, starred: starred?.n ?? 0,
      noted: noted?.n ?? 0, addresses: addresses?.n ?? 0,
    },
  });
});

// v3.2.0 — the print studio's letterhead mark: any signed-in reader may print,
// so the mark rides a dedicated endpoint instead of the admin-only settings GET.
// Registered BEFORE /:id — Hono matches in order and an "print-identity" email
// id would otherwise answer 404 here.
app.get('/print-identity', requireUser, async (c) => {
  const logo = await getSetting(c.env, 'print_logo');
  return c.json({ ok: true, logo: logo || null });
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
  // a guest opening a letter from outside the shared set gets an honest 404
  const emScope = shareScope(u);
  if (emScope && !emScope.includes(String(email.address_id))) return c.json({ ok: false, error: 'not_found' }, 404);

  const atts = await c.env.DB.prepare(
    'SELECT id, filename, content_type, size, content_id, (content_b64 IS NOT NULL OR chunks > 0) AS available, (chunks > 0) AS chunked FROM attachments WHERE email_id = ? ORDER BY id'
  ).bind(id).all().catch(() => null);
  const attList = (atts?.results ?? []) as Record<string, unknown>[];
  const attsLegacy = atts === null ? await c.env.DB.prepare(
    'SELECT id, filename, content_type, size, NULL AS content_id, (content_b64 IS NOT NULL) AS available, 0 AS chunked FROM attachments WHERE email_id = ? ORDER BY id'
  ).bind(id).all() : null;
  const note = await c.env.DB.prepare('SELECT body, color, pinned, updated_at FROM email_notes WHERE email_id = ?').bind(id).first();

  // the advanced-details panel reads this: a compact header snapshot
  // (path, auth results, ids) captured on delivery / on send
  let headers: { k: string; v: string }[] = [];
  try { headers = JSON.parse(String(email.headers ?? '[]')); } catch { headers = []; }
  delete email.headers;

  if (!email.is_read) await c.env.DB.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').bind(id).run();
  return c.json({ ok: true, email: { ...email, is_read: 1 }, headers, attachments: attsLegacy ? attsLegacy.results ?? [] : attList, note: note ?? null });
});

// single field toggles (+ filing a message into one of the account's own folders)
app.patch('/:id', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const id = c.req.param('id');
  const body = await c.req.json<{ is_read?: boolean; starred?: boolean; folder_id?: string | null }>().catch(() => null);
  const em = await c.env.DB.prepare('SELECT id, address_id FROM emails WHERE id = ? AND user_id = ?').bind(id, u.id)
    .first<{ id: string; address_id: string }>();
  if (!em) return c.json({ ok: false, error: 'not_found' }, 404);
  const emScope = shareScope(u);
  if (emScope && !emScope.includes(em.address_id)) return c.json({ ok: false, error: 'not_found' }, 404);
  if (body?.starred !== undefined && !shareCan(u, 'star')) return c.json({ ok: false, error: 'forbidden' }, 403);
  if (body?.folder_id !== undefined && !shareCan(u, 'archive')) return c.json({ ok: false, error: 'forbidden' }, 403);
  if (body?.is_read !== undefined) await c.env.DB.prepare('UPDATE emails SET is_read = ? WHERE id = ?').bind(body.is_read ? 1 : 0, id).run();
  if (body?.starred !== undefined) await c.env.DB.prepare('UPDATE emails SET starred = ? WHERE id = ?').bind(body.starred ? 1 : 0, id).run();
  if (body?.folder_id !== undefined) {
    if (body.folder_id === null || body.folder_id === '') {
      // back to the plain inbox
      await c.env.DB.prepare('UPDATE emails SET folder_id = NULL WHERE id = ?').bind(id).run();
    } else {
      // the folder must exist, belong to this user AND to the same account —
      // a message never crosses accounts through a folder
      const folder = await c.env.DB.prepare('SELECT id FROM mail_folders WHERE id = ? AND user_id = ? AND address_id = ?')
        .bind(body.folder_id, u.id, em.address_id).first<{ id: string }>();
      if (!folder) return c.json({ ok: false, error: 'invalid_folder' }, 400);
      await c.env.DB.prepare('UPDATE emails SET folder_id = ? WHERE id = ?').bind(folder.id, id).run();
    }
  }
  return c.json({ ok: true });
});

app.delete('/:id', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  if (!shareCan(u, 'delete')) return c.json({ ok: false, error: 'forbidden' }, 403);
  const id = c.req.param('id');
  const emScope = shareScope(u);
  if (emScope && !emScope.length) return c.json({ ok: true }); // nothing is theirs to delete
  if (emScope) {
    await c.env.DB.prepare(`DELETE FROM emails WHERE id = ? AND user_id = ? AND address_id IN ${inPh(emScope)}`).bind(id, u.id, ...emScope).run();
  } else {
    await c.env.DB.prepare('DELETE FROM emails WHERE id = ? AND user_id = ?').bind(id, u.id).run();
  }
  return c.json({ ok: true });
});

// bulk actions
app.post('/bulk', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const body = await c.req.json<{ ids?: string[]; action?: string; folder_id?: string | null }>().catch(() => null);
  const ids = (body?.ids ?? []).slice(0, 500);
  const action = body?.action ?? '';
  if (!ids.length) return c.json({ ok: false, error: 'no_ids' }, 400);
  // the guest's bulk actions stay inside the shared mailbox set — every
  // update carries the address guard, so foreign letters can never be touched
  const gScope = shareScope(u);
  const scope = gScope && !gScope.length ? ' AND 1=0' : (gScope ? ` AND address_id IN ${inPh(gScope)}` : '');
  const sb = gScope && gScope.length ? [...gScope] : [];
  const permNeeded: Record<string, string> = { read: 'read', unread: 'read', star: 'star', unstar: 'star', delete: 'delete', move: 'archive' };
  const perm = permNeeded[action];
  if (perm && !shareCan(u, perm)) return c.json({ ok: false, error: 'forbidden' }, 403);
  const ph = ids.map(() => '?').join(',');
  switch (action) {
    case 'read': await c.env.DB.prepare(`UPDATE emails SET is_read = 1 WHERE user_id = ? AND id IN (${ph})${scope}`).bind(u.id, ...ids, ...sb).run(); break;
    case 'unread': await c.env.DB.prepare(`UPDATE emails SET is_read = 0 WHERE user_id = ? AND id IN (${ph})${scope}`).bind(u.id, ...ids, ...sb).run(); break;
    case 'star': await c.env.DB.prepare(`UPDATE emails SET starred = 1 WHERE user_id = ? AND id IN (${ph})${scope}`).bind(u.id, ...ids, ...sb).run(); break;
    case 'unstar': await c.env.DB.prepare(`UPDATE emails SET starred = 0 WHERE user_id = ? AND id IN (${ph})${scope}`).bind(u.id, ...ids, ...sb).run(); break;
    case 'delete': await c.env.DB.prepare(`DELETE FROM emails WHERE user_id = ? AND id IN (${ph})${scope}`).bind(u.id, ...ids, ...sb).run(); break;
    case 'move': {
      // filing a whole selection into one folder of THIS account —
      // the folder must belong to the caller and to every message's account
      const fid = body?.folder_id ?? null;
      if (!fid) return c.json({ ok: false, error: 'folder_required' }, 400);
      const rows = await c.env.DB.prepare(`SELECT id, address_id FROM emails WHERE user_id = ? AND id IN (${ph})`).bind(u.id, ...ids).all<{ id: string; address_id: string }>();
      const folder = await c.env.DB.prepare('SELECT id, address_id FROM mail_folders WHERE id = ? AND user_id = ?')
        .bind(fid, u.id).first<{ id: string; address_id: string }>();
      if (!folder) return c.json({ ok: false, error: 'invalid_folder' }, 400);
      const match = (rows.results ?? []).filter((r) => r.address_id === folder.address_id && (!gScope || gScope.includes(r.address_id))).map((r) => r.id);
      if (match.length) {
        const mph = match.map(() => '?').join(',');
        await c.env.DB.prepare(`UPDATE emails SET folder_id = ? WHERE user_id = ? AND id IN (${mph})`).bind(folder.id, u.id, ...match).run();
      }
      break;
    }
    default: return c.json({ ok: false, error: 'unknown_action' }, 400);
  }
  return c.json({ ok: true });
});

// ---------- notes (annotations on emails) ----------

app.put('/:id/note', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  if (!shareCan(u, 'notes')) return c.json({ ok: false, error: 'forbidden' }, 403);
  const id = c.req.param('id');
  const body = await c.req.json<{ body?: string; color?: string; pinned?: boolean }>().catch(() => null);
  const own = await c.env.DB.prepare('SELECT id, address_id FROM emails WHERE id = ? AND user_id = ?').bind(id, u.id).first<{ id: string; address_id: string }>();
  if (!own) return c.json({ ok: false, error: 'not_found' }, 404);
  const ownScope = shareScope(u);
  if (ownScope && !ownScope.includes(own.address_id)) return c.json({ ok: false, error: 'not_found' }, 404);
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

// v3.2.2 — the download (and preview) tap. Chunked payloads are reassembled
// in order; ?disp=inline serves the viewable families (images, audio, video,
// pdf, plain text) to the reader's viewer, everything else — and every
// active type — stays a forced download with a neutral content-type, the
// same discipline v3.1.3 installed. Filenames ride RFC 5987 so Persian and
// Arabic names survive instead of collapsing into underscores.
const INLINE_OK = (t: string) => /^(image\/(png|jpeg|jpg|gif|webp|bmp|avif)|audio\/|video\/|application\/pdf|text\/plain)/.test(t);

app.get('/attachment/:attId', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  const attId = c.req.param('attId');
  const disp = c.req.query('disp') === 'inline' ? 'inline' : 'attachment';
  const row = await c.env.DB.prepare(
    `SELECT at.filename, at.content_type, at.content_b64, at.email_id, e.address_id AS address_id FROM attachments at
     JOIN emails e ON e.id = at.email_id WHERE at.id = ? AND e.user_id = ?`
  ).bind(attId, u.id).first<{ filename: string; content_type: string; content_b64: string | null; email_id: string; address_id: string }>();
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);
  const atScope = shareScope(u);
  if (atScope && !atScope.includes(row.address_id)) return c.json({ ok: false, error: 'not_found' }, 404);

  let b64 = row.content_b64 ?? '';
  if (!b64) {
    // the chunked form: ordered slices reassembled — an older database
    // without the chunks table answers with the honest 413 again
    const chunks = await c.env.DB.prepare(
      'SELECT data FROM attachment_chunks WHERE att_id = ? ORDER BY idx'
    ).bind(attId).all<{ data: string }>().catch(() => null);
    if (!chunks?.results?.length) return c.json({ ok: false, error: 'attachment_too_large' }, 413);
    b64 = chunks.results.map((r) => r.data).join('');
  }

  const RAW_TYPE = (row.content_type || '').toLowerCase().split(';')[0].trim();
  const ACTIVE = new Set(['text/html', 'image/svg+xml', 'application/xhtml+xml', 'application/xhtml', 'text/xml', 'application/xml']);
  const safeType = ACTIVE.has(RAW_TYPE) ? 'application/octet-stream' : (row.content_type || 'application/octet-stream');
  const inline = disp === 'inline' && !ACTIVE.has(RAW_TYPE) && INLINE_OK(RAW_TYPE);
  const name = (row.filename || 'attachment').replace(/[\r\n"\\]/g, '_');
  const ascii = name.replace(/[^\w.\- ]/g, '_');
  const headers: Record<string, string> = {
    'content-type': inline ? safeType : 'application/octet-stream',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'x-content-type-options': 'nosniff',
  };
  if (!inline) headers['content-security-policy'] = "default-src 'none'; sandbox";
  return new Response(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)).buffer as ArrayBuffer, { headers });
});

// ---------- compose / send ----------

app.post('/send', requireUser, async (c) => {
  const u = c.get('user') as SessionUser;
  if (!shareCan(u, 'compose')) return c.json({ ok: false, error: 'forbidden' }, 403);
  // v3.1.2 — the outbox is a metered resource: without a cap, one compromised
  // session (or one over-privileged guest) could pump unlimited mail through
  // the owner's provider account until it gets suspended. 20 / 10 min / IP.
  if (!(await rateLimit(c.env, clientIp(c), 'send', 20))) return c.json({ ok: false, error: 'rate_limited' }, 429);
  const body = await c.req.json<{
    from_address_id?: string; to?: string; subject?: string; text?: string; html?: string;
    attachments?: { filename?: string; content_type?: string; content_b64?: string }[];
  }>().catch(() => null);
  const to = clean(body?.to, 120);
  const subject = clean(body?.subject, 200) || '(no subject)';
  const text = typeof body?.text === 'string' ? body.text.slice(0, 100_000) : '';
  const html = typeof body?.html === 'string' ? body.html.slice(0, 300_000) : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return c.json({ ok: false, error: 'invalid_recipient' }, 400);
  if (!text && !html) return c.json({ ok: false, error: 'empty_body' }, 400);

  // v3.2.3 — outgoing attachments caught up with the incoming path and with
  // Gmail: 20 files, 20 MB each, 20 MB per letter (Brevo's own total ceiling).
  // A file over the budget is rejected with
  // attachment_too_big — the composer says so before sending, so this is
  // the server's double-check, not the user's first surprise.
  const MAX_ATT_B64 = 26_666_668;     // ~20 MB raw per file (Gmail's ceiling)
  const MAX_ATT_COUNT = 20;
  const MAX_TOTAL_B64 = 26_666_668;   // ~20 MB raw per letter (Brevo's ceiling)
  const rawAtts = Array.isArray(body?.attachments) ? body!.attachments!.slice(0, MAX_ATT_COUNT) : [];
  const attachments: { filename: string; content_type: string; content_b64: string; size: number }[] = [];
  let totalB64 = 0;
  for (const a of rawAtts) {
    const b64 = typeof a?.content_b64 === 'string' ? a.content_b64.replace(/^data:[^;]*;base64,/, '') : '';
    if (!b64) continue;
    if (!/^[A-Za-z0-9+/=\s]+$/.test(b64) || b64.length > MAX_ATT_B64) return c.json({ ok: false, error: 'attachment_too_big' }, 413);
    totalB64 += b64.length;
    if (totalB64 > MAX_TOTAL_B64) return c.json({ ok: false, error: 'attachment_too_big' }, 413);
    attachments.push({
      filename: clean(a.filename ?? 'attachment', 120) || 'attachment',
      content_type: clean(a.content_type ?? 'application/octet-stream', 80) || 'application/octet-stream',
      content_b64: b64.replace(/\s+/g, ''),
      size: Math.floor(b64.length * 0.75),
    });
  }

  // the guest sends AS one of the shared addresses — the from field is not theirs to pick
  const sendScope = shareScope(u);
  if (sendScope && !sendScope.length) return c.json({ ok: false, error: 'forbidden' }, 403);
  const fromId = sendScope ? (body?.from_address_id && sendScope.includes(body.from_address_id) ? body.from_address_id : sendScope[0]) : (body?.from_address_id ?? '');
  const from = await c.env.DB.prepare('SELECT address FROM addresses WHERE id = ? AND user_id = ?')
    .bind(fromId, u.id).first<{ address: string }>();
  if (!from) return c.json({ ok: false, error: 'invalid_sender' }, 400);

  const provider = (await getSetting(c.env, 'sending_provider')) ?? 'none';
  if (provider === 'none') return c.json({ ok: false, error: 'sending_not_configured' }, 409);

  const res = await sendViaProvider(c.env, {
    to, subject, text, html, replyTo: from.address,
    attachments: attachments.map(({ filename, content_type, content_b64 }) => ({ filename, content_type, content_b64 })),
  });
  if (!res.ok) return c.json({ ok: false, error: 'send_failed', detail: res.error }, 502);

  // the message becomes a real row of this account (direction='out') — it
  // opens, searches, files and inspects exactly like received mail, and the
  // dynamic island can point straight at it
  const emailId = uid('eml_');
  const sentHeaders = [
    { k: 'from', v: from.address },
    { k: 'to', v: to },
    { k: 'subject', v: subject },
    { k: 'date', v: new Date().toUTCString() },
    ...(res.id ? [{ k: 'message-id', v: res.id }] : []),
    { k: 'received', v: `by ${provider} for ${from.address}; composed in Cmail` },
  ];
  try {
    await c.env.DB.prepare(
      `INSERT INTO emails (id, address_id, user_id, from_name, from_addr, to_addr, subject, preview, text_body, html_body, size, is_read, received_at, direction, headers, provider)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'out', ?, ?)`
    ).bind(
      emailId, fromId, u.id, from.address, to, subject,
      (typeof body?.text === 'string' ? body.text : '').slice(0, 180) || '(no preview)',
      text.slice(0, 400_000), html.slice(0, 900_000),
      text.length + html.length + attachments.reduce((n, a) => n + a.size, 0), now(),
      JSON.stringify(sentHeaders).slice(0, 24_000),
      provider,
    ).run();
    // the sent copy carries its own attachments — inline for the small,
    // chunked for the big (0014); the reader lists them and the download
    // endpoint serves them exactly like received mail. A storage hiccup
    // never un-sends the letter: the sent row stays, the file shows as
    // refused if its payload could not land.
    for (const a of attachments) {
      const attId = uid('att_');
      try {
        if (a.content_b64.length <= 900_000) {
          await c.env.DB.prepare(
            'INSERT INTO attachments (id, email_id, filename, content_type, size, content_b64, chunks, content_id) VALUES (?, ?, ?, ?, ?, ?, 0, NULL)'
          ).bind(attId, emailId, a.filename, a.content_type, a.size, a.content_b64).run();
        } else {
          const CHUNK_B64 = 1_200_000;
          await c.env.DB.prepare(
            'INSERT INTO attachments (id, email_id, filename, content_type, size, content_b64, chunks, content_id) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL)'
          ).bind(attId, emailId, a.filename, a.content_type, a.size, Math.ceil(a.content_b64.length / CHUNK_B64)).run();
          for (let i = 0, off = 0; off < a.content_b64.length; i++, off += CHUNK_B64) {
            await c.env.DB.prepare('INSERT INTO attachment_chunks (att_id, idx, data) VALUES (?, ?, ?)')
              .bind(attId, i, a.content_b64.slice(off, off + CHUNK_B64)).run();
          }
        }
      } catch {
        // pre-0014 database: the old single-row shape, best effort
        try {
          await c.env.DB.prepare(
            'INSERT INTO attachments (id, email_id, filename, content_type, size, content_b64) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(attId, emailId, a.filename, a.content_type, a.size, a.content_b64.length <= 900_000 ? a.content_b64 : null).run();
        } catch { /* the sent mail itself already left */ }
      }
    }
  } catch { /* an older schema without direction must never fail a sent mail */ }

  return c.json({ ok: true, id: emailId });
});

export default app;
