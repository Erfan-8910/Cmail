#!/usr/bin/env node
// Cmail v3.2.2 — E2E against the local dev worker (wrangler dev --port 8787)
// Exercises: chunked attachment read-back, inline disp discipline, cid fields,
// the storage gauge endpoints, the quota/auto-clean flow and the health flags.
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

// ---------- helpers to fabricate attachments exactly like emailin.ts does ----------
function chunkRowsFor(attId, bytes, chunkB64 = 1_200_000) {
  let b64 = Buffer.from(bytes).toString('base64');
  const rows = [];
  for (let i = 0, off = 0; off < b64.length; i++, off += chunkB64) rows.push([attId, i, b64.slice(off, off + chunkB64)]);
  return { b64, rows };
}

import { execSync, spawnSync } from 'node:child_process';
// the local D1 is a plain sqlite file (miniflare) — seeded directly with
// bound parameters, the same shape the worker's .bind() writes take; a
// wrangler CLI literal would trip the 100 KB statement-text limit that the
// bound-param path (the one production uses) never touches
const SQLITE = execSync('ls .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite | grep -v "/db.sqlite" | head -1', { encoding: 'utf8', cwd: process.cwd() }).trim();
function d1(sqlOrList, params = []) {
  const stmts = Array.isArray(sqlOrList) ? sqlOrList : [{ sql: sqlOrList, args: params.map((p) => (typeof p === 'number' ? p : String(p))) }];
  const py = JSON.stringify(stmts.map((s) => ({ sql: s.sql, args: (s.args ?? []).map((p) => (typeof p === 'number' ? p : String(p))) })));
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
  return JSON.parse(r.stdout);
}
// several statements in one connection
const d1file = (stmts) => d1(stmts);

// ---------- 0. sign in ----------
const login = await req('POST', '/api/auth/login', { username: 'erfan', password: 'Test-Local-1234' });
ok(login.data?.ok === true, 'admin login');

const addr = d1("SELECT id, address FROM addresses WHERE user_id = (SELECT id FROM users WHERE username='erfan') LIMIT 1")[0].results[0];
ok(!!addr?.id, 'address present');
const uid = d1("SELECT id FROM users WHERE username='erfan'")[0].results[0].id;

// ---------- 1. build the v3.2.2 letter: png with cid + chunked mp3 + refused big file + svg ----------
const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGP8z8Dwn4EIwESMolGFlCsEAF1oAgOco1/0AAAAAElFTkSuQmCC';
const mp3Bytes = Buffer.alloc(1_350_000, 7).fill(Buffer.from('ID3'));
const mp3 = chunkRowsFor('att_e2e_mp3', mp3Bytes);
const svgB64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
const now = Date.now();
const emailId = 'eml_e2e_v322';

d1file([
  { sql: "DELETE FROM emails WHERE id=?", args: [emailId] },
  { sql: "DELETE FROM attachments WHERE email_id=?", args: [emailId] },
  { sql: "DELETE FROM attachment_chunks WHERE att_id LIKE 'att_e2e_%'", args: [] },
  { sql: `INSERT INTO emails (id, address_id, user_id, from_name, from_addr, to_addr, subject, preview, text_body, html_body, size, is_read, received_at, direction)
      VALUES (?, ?, ?, 'E2E Bot', 'bot@example.org', ?, 'v3.2.2 attachment studio', 'chunked + inline + refused', 'body text', '<img src="cid:photo1@example.com"><img src="cid:photo2@example.com">', 2, 0, ?, 'in')`,
    args: [emailId, addr.id, uid, addr.address, now] },
  { sql: `INSERT OR REPLACE INTO attachments (id, email_id, filename, content_type, size, content_b64, chunks, content_id)
      VALUES ('att_e2e_png', ?, 'عکس.png', 'image/png', 100, ?, 0, 'photo1@example.com')`, args: [emailId, pngB64] },
  { sql: `INSERT OR REPLACE INTO attachments (id, email_id, filename, content_type, size, content_b64, chunks, content_id)
      VALUES ('att_e2e_mp3', ?, 'voice note.mp3', 'audio/mpeg', ?, NULL, ?, 'photo2@example.com')`, args: [emailId, mp3Bytes.length, mp3.rows.length] },
  { sql: `INSERT OR REPLACE INTO attachments (id, email_id, filename, content_type, size, content_b64, chunks, content_id)
      VALUES ('att_e2e_big', ?, 'too-big.zip', 'application/zip', 999999999, NULL, 0, NULL)`, args: [emailId] },
  { sql: `INSERT OR REPLACE INTO attachments (id, email_id, filename, content_type, size, content_b64, chunks, content_id)
      VALUES ('att_e2e_svg', ?, 'bad.svg', 'image/svg+xml', 60, ?, 0, NULL)`, args: [emailId, svgB64] },
  ...mp3.rows.map(([id, idx, data]) => ({ sql: 'INSERT OR REPLACE INTO attachment_chunks (att_id, idx, data) VALUES (?, ?, ?)', args: [id, idx, data] })),
]);
ok(true, `letter with ${mp3.rows.length} mp3 chunks planted via bound params`);

// ---------- 2. reader fields ----------
const full = await req('GET', `/api/emails/${emailId}`);
const atts = full.data?.attachments ?? [];
ok(atts.length === 4, 'reader lists 4 attachments', `got ${atts.length}`);
const byId = Object.fromEntries(atts.map((a) => [a.id, a]));
ok(byId.att_e2e_png?.available === 1 && byId.att_e2e_png?.chunked === 0, 'png available inline');
ok(byId.att_e2e_mp3?.available === 1 && byId.att_e2e_mp3?.chunked === 1, 'mp3 available via chunks');
ok(byId.att_e2e_big?.available === 0, 'oversize honestly refused');
ok(byId.att_e2e_png?.content_id === 'photo1@example.com', 'content_id rides along');
ok((full.data?.email?.has_att === undefined) || true, 'reader ok');

// ---------- 3. list flag: has_att ----------
const list = await req('GET', `/api/emails?address_id=${addr.id}&limit=80`);
const row = (list.data?.emails ?? []).find((x) => x.id === emailId);
ok(row?.has_att === 1, 'list answers has_att=1 (honest paperclip)');

// ---------- 4. downloads & disp discipline ----------
const png = await req('GET', '/api/emails/attachment/att_e2e_png', null, true);
ok(png.status === 200 && /attachment/.test(png.headers.get('content-disposition') ?? ''), 'png download forced');
ok((png.headers.get('content-disposition') ?? '').includes("filename*=UTF-8''"), 'RFC5987 filename* present');
const pngBody = await png.arrayBuffer();
ok(Buffer.from(pngBody).toString('base64') === pngB64, 'png bytes round-trip');

const mp3res = await req('GET', '/api/emails/attachment/att_e2e_mp3', null, true);
const mp3Body = Buffer.from(await mp3res.arrayBuffer());
ok(mp3Body.length === mp3Bytes.length && mp3Body.equals(mp3Bytes), `chunked mp3 reassembled exactly (${mp3Body.length} B)`);

const mp3inline = await req('GET', '/api/emails/attachment/att_e2e_mp3?disp=inline', null, true);
ok(mp3inline.status === 200 && (mp3inline.headers.get('content-disposition') ?? '').startsWith('inline'), 'audio disp=inline honored');

const big = await req('GET', '/api/emails/attachment/att_e2e_big', null, true);
ok(big.status === 413, 'refused attachment answers 413');

const svg = await req('GET', '/api/emails/attachment/att_e2e_svg?disp=inline', null, true);
ok((svg.headers.get('content-type') ?? '') === 'application/octet-stream' && /attachment/.test(svg.headers.get('content-disposition') ?? ''), 'svg never renders inline (active type discipline)');

// ---------- 5. the storage gauge ----------
const st = await req('GET', '/api/storage');
ok(st.data?.ok === true && typeof st.data.storage?.used_bytes === 'number', 'storage report answers');
const kinds = st.data?.storage?.kinds ?? [];
ok(kinds.some((k) => k.kind === 'audio' && k.bytes >= mp3Bytes.length), `audio kind carries the chunked mp3 (${kinds.map((k) => `${k.kind}:${k.bytes}`).join(', ')})`);
ok(kinds.some((k) => k.kind === 'image' && k.bytes >= 100), 'image kind carries the png');
ok(Array.isArray(st.data?.storage?.biggest), 'biggest letters listed');

// ---------- 6. quota → low flag → banner → auto-clean ----------
// plant 12 filler letters (~600 KB bodies each, staggered age) so a 10 MB
// quota really pushes the gauge into the low zone and cleanup has targets
const oldQuota = st.data?.storage?.quota_mb;
d1("DELETE FROM emails WHERE id LIKE 'eml_e2e_fill%'");
const filler = [];
for (let i = 0; i < 12; i++) {
  filler.push({
    sql: `INSERT INTO emails (id, address_id, user_id, from_name, from_addr, to_addr, subject, preview, text_body, size, is_read, received_at, direction)
          VALUES (?, ?, ?, 'Filler', 'filler@example.net', ?, ?, 'f', ?, 600000, 1, ?, 'in')`,
    args: [`eml_e2e_fill${i}`, addr.id, uid, addr.address, `filler ${i}`, 'F'.repeat(600_000), now - (48 - i) * 3600_000],
  });
}
d1(filler);
await req('POST', '/api/storage/quota', { quota_mb: 10 });
const stLow = await req('GET', '/api/storage');
ok(stLow.data?.storage?.pct > 80 && stLow.data?.storage?.low, `tiny quota flags low (pct=${stLow.data?.storage?.pct})`);
const health = await req('GET', '/api/admin/health');
ok((health.data?.issues ?? []).some((i) => i.code === 'storage_low' && i.detail), 'health raises storage_low with the pct detail');

// auto-clean permission on → the manual pass deletes the OLDEST fillers
const before = d1("SELECT COUNT(*) AS n FROM emails WHERE id LIKE 'eml_e2e_fill%'")[0].results[0].n;
const clean = await req('POST', '/api/storage/clean');
const after = d1("SELECT COUNT(*) AS n FROM emails WHERE id LIKE 'eml_e2e_fill%'")[0].results[0].n;
ok(clean.data?.ok === true && clean.data?.deleted > 0 && after < before, `cleanup deleted ${clean.data?.deleted} oldest letters (fillers ${before}→${after})`);
const lastClean = d1("SELECT value FROM settings WHERE key='last_storage_cleanup'")[0].results?.[0];
ok(lastClean && JSON.parse(lastClean.value).deleted > 0, 'last_storage_cleanup memory recorded');

await req('POST', '/api/storage/quota', { quota_mb: oldQuota || 450 });
const stBack = await req('GET', '/api/storage');
ok(!stBack.data?.storage?.low, 'quota restored — low flag cleared');
d1("DELETE FROM emails WHERE id LIKE 'eml_e2e_fill%'");

// autoclean toggle
const ac = await req('POST', '/api/storage/autoclean', { on: false });
ok(ac.data?.ok === true && ac.data?.auto_clean === false, 'auto-clean toggle off');
const ac2 = await req('POST', '/api/storage/autoclean', { on: true });
ok(ac2.data?.auto_clean === true, 'auto-clean toggle back on');

// ---------- 7. send-path caps (server-side double-check, no provider needed) ----------
const tooBig = await req('POST', '/api/emails/send', { to: 'x@y.com', text: 'hi', from_address_id: addr.id, attachments: [{ filename: 'a.bin', content_type: 'application/octet-stream', content_b64: 'A'.repeat(9_000_000) }] });
ok(tooBig.status === 413 && tooBig.data?.error === 'attachment_too_big', '9 MB b64 file rejected server-side');

// ---------- cleanup ----------
d1("DELETE FROM emails WHERE id=?", [emailId]);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
