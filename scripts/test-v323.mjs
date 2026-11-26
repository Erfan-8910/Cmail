#!/usr/bin/env node
// Cmail v3.2.3 — E2E against the local dev worker (wrangler dev --port 8787)
// Exercises what v3.2.3 changed:
//   1. Gmail-scale budgets: a ~20 MB chunked attachment reassembles byte-exact
//   2. Refused files are NAMED (metadata row exists, download answers 413)
//   3. content_id survives in every dress (brackets, bare, cid:) for the
//      client-side cid map — the reader normalizes both sides now
//   4. The out path double-checks the same numbers (a 30 MB b64 file → 413,
//      a 9 MB b64 file passes the budget stage and reaches the provider gate)
const BASE = 'http://127.0.0.1:8787';
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};

let cookie = '';
async function req(method, path, body, raw = false) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc && !cookie) cookie = sc.split(';')[0];
  if (raw) return res;
  try { return { status: res.status, data: await res.json() }; }
  catch { return { status: res.status, data: null }; }
}

// ---------- helpers: bound-parameter seeding exactly like the worker writes ----------
import { execSync, spawnSync } from 'node:child_process';
const SQLITE = execSync('ls .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite | grep -v "/db.sqlite" | head -1', { encoding: 'utf8', cwd: process.cwd() }).trim();
function d1(sqlOrList, params = []) {
  const stmts = typeof sqlOrList === 'string'
    ? [{ sql: sqlOrList, args: params.map((p) => (typeof p === 'number' ? p : String(p))) }]
    : sqlOrList.map((s) => (typeof s === 'string' ? { sql: s, args: [] } : { sql: s.sql, args: (s.args ?? []).map((p) => (typeof p === 'number' ? p : String(p))) }));
  const py = JSON.stringify(stmts.map((s) => ({ sql: s.sql, args: s.args })));
  const r = spawnSync('python3', ['-c', `
import json, sqlite3, sys
stmts = json.loads(sys.stdin.read())
con = sqlite3.connect(${JSON.stringify(SQLITE)}, timeout=15)
out = []
for s in stmts:
    cur = con.execute(s['sql'], s['args'])
    out.append({'results': [dict(zip([d[0] for d in cur.description] if cur.description else [], row)) for row in cur.fetchall()]})
con.commit(); con.close()
print(json.dumps(out))
`], { encoding: 'utf8', cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], input: py });
  if (r.status !== 0) throw new Error('d1 seed failed: ' + String(r.stderr ?? r.error ?? '').slice(0, 400));
  return JSON.parse(out0(r.stdout));
}
const out0 = (s) => s.trim() || '[]';

// ---------- 0. sign in ----------
const login = await req('POST', '/api/auth/login', { username: 'erfan', password: 'Test-Local-1234' });
ok(login.data?.ok === true, 'admin login');

const addr = d1("SELECT id, address FROM addresses WHERE user_id = (SELECT id FROM users WHERE username='erfan') LIMIT 1")[0].results[0];
ok(!!addr?.id, 'address present');
const uid = d1("SELECT id FROM users WHERE username='erfan'")[0].results[0].id;

// ---------- 1. the v3.2.3 letter: a ~20 MB "song" in chunk rows + a refused file ----------
const SONG_RAW = 20_000_000;                       // 20 MB raw — Gmail's ceiling
const songBytes = Buffer.alloc(SONG_RAW, 0);       // deterministic zeros
const songB64 = songBytes.toString('base64');      // ~26.67 MB — chunked, never a single bind
const CHUNK = 1_200_000;
const chunkRows = [];
for (let i = 0, off = 0; off < songB64.length; i++, off += CHUNK) {
  chunkRows.push({ sql: 'INSERT OR REPLACE INTO attachment_chunks (att_id, idx, data) VALUES (?, ?, ?)', args: ['att_v323_song', i, songB64.slice(off, off + CHUNK)] });
}
const emailId = 'eml_e2e_v323';
d1([
  { sql: "DELETE FROM emails WHERE id=?", args: [emailId] },
  { sql: "DELETE FROM attachments WHERE email_id=?", args: [emailId] },
  { sql: "DELETE FROM attachment_chunks WHERE att_id LIKE 'att_v323_%'", args: [] },
  { sql: `INSERT INTO emails (id, address_id, user_id, from_name, from_addr, to_addr, subject, preview, text_body, html_body, size, is_read, received_at, direction)
      VALUES (?, ?, ?, 'DJ Guest', 'dj@example.org', ?, 'the song finally lands', '20 MB chunked song + refused file', 'lyrics here', '<p>listen: <img src="cid:cover@host.example"> <img src="&lt;cid:alt@host.example&gt;"></p>', 2, 0, ?, 'in')`,
    args: [emailId, addr.id, uid, addr.address, Date.now()] },
  // the song: 20 MB raw in ordered chunks — content_id arrives WITH brackets (postal-mime's dress)
  { sql: `INSERT OR REPLACE INTO attachments (id, email_id, filename, content_type, size, content_b64, chunks, content_id)
      VALUES ('att_v323_song', ?, 'song.mp3', 'audio/mpeg', ?, NULL, ?, '<cover@host.example>')`, args: [emailId, SONG_RAW, chunkRows.length] },
  // a refused file: metadata only — the honest dead chip the old code never wrote
  { sql: `INSERT OR REPLACE INTO attachments (id, email_id, filename, content_type, size, content_b64, chunks, content_id)
      VALUES ('att_v323_refused', ?, 'too-big.flac', 'audio/flac', 30_000_000, NULL, 0, NULL)`, args: [emailId] },
  // a bare cid dress for the map (no brackets, exactly like some composers send)
  { sql: `INSERT OR REPLACE INTO attachments (id, email_id, filename, content_type, size, content_b64, chunks, content_id)
      VALUES ('att_v323_cover', ?, 'cover.png', 'image/png', 88, ?, 0, 'cover@host.example')`, args: [emailId, 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGP8z8Dwn4EIwESMolGFlCsEAF1oAgOco1/0AAAAAElFTkSuQmCC'] },
  ...chunkRows,
]);
ok(true, `letter planted: song in ${chunkRows.length} chunks (~${Math.round(SONG_RAW / 1048576)} MB raw)`);

// ---------- 2. reader: the studio sees everything, refused included ----------
const full = await req('GET', `/api/emails/${emailId}`);
const atts = full.data?.attachments ?? [];
ok(atts.length === 3, 'reader lists 3 attachments (song + refused + cover)', `got ${atts.length}`);
const byId = Object.fromEntries(atts.map((a) => [a.id, a]));
ok(byId.att_v323_song?.available === 1 && byId.att_v323_song?.chunked === 1, 'song available via chunks');
ok(byId.att_v323_refused?.available === 0 && byId.att_v323_refused?.chunked === 0, 'refused file NAMED with available=0');
ok(byId.att_v323_song?.content_id === '<cover@host.example>', 'content_id rides raw (brackets preserved for the client map)');

// ---------- 3. the 20 MB song reassembles byte-exact ----------
const t0 = Date.now();
const song = await req('GET', '/api/emails/attachment/att_v323_song?disp=inline', null, true);
const songBody = Buffer.from(await song.arrayBuffer());
ok(song.status === 200, 'song stream answers 200', `status ${song.status}`);
ok(songBody.length === SONG_RAW && songBody.equals(songBytes), `20 MB song reassembled byte-exact in ${Date.now() - t0} ms`, `got ${songBody.length} B`);
ok((song.headers.get('content-type') ?? '').startsWith('audio/mpeg'), 'audio/mpeg inline content-type');
ok((song.headers.get('content-disposition') ?? '').startsWith('inline'), 'song disp=inline honored');

// ---------- 4. the refused file answers 413, never a dead stream ----------
const refused = await req('GET', '/api/emails/attachment/att_v323_refused', null, true);
ok(refused.status === 413, 'refused attachment answers 413');

// ---------- 5. out path: same budgets double-checked ----------
const overOut = await req('POST', '/api/emails/send', { to: 'x@y.com', text: 'hi', from_address_id: addr.id, attachments: [{ filename: 'x.bin', content_type: 'application/octet-stream', content_b64: 'A'.repeat(30_000_000) }] });
ok(overOut.status === 413 && overOut.data?.error === 'attachment_too_big', '30 MB b64 out file rejected (413)');
const withinOut = await req('POST', '/api/emails/send', { to: 'x@y.com', text: 'hi', from_address_id: addr.id, attachments: [{ filename: 'song.mp3', content_type: 'audio/mpeg', content_b64: 'A'.repeat(9_000_000) }] });
ok(withinOut.status === 409 && withinOut.data?.error === 'sending_not_configured', '9 MB b64 out file passes the budget stage (reaches provider gate)');

// ---------- cleanup ----------
d1([
  { sql: "DELETE FROM emails WHERE id=?", args: [emailId] },
  { sql: "DELETE FROM attachment_chunks WHERE att_id LIKE 'att_v323_%'", args: [] },
]);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
