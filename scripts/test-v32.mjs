// Cmail — v3.2.0 feature E2E: attachments out, print identity, version stamp.
// Run against a FRESH wrangler dev on :8791 (local D1 wiped first).
import { execSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:8791';
let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}

async function req(method, path, body, cookie) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
}
const cookieOf = (r) => r.setCookie ? r.setCookie.split(';')[0] : '';

function d1(sql) {
  // the worker under test may run against a non-default persist dir —
  // D1_PERSIST=/tmp/wf8791 node scripts/test-v32.mjs keeps the probe honest
  const PERSIST = process.env.D1_PERSIST ? ` --persist-to ${process.env.D1_PERSIST}` : '';
  const out = execSync(`npx wrangler d1 execute cmail-db --local${PERSIST} --json --command "${sql.replace(/\$/g, '\\$')}"`, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const j = JSON.parse(out.slice(out.indexOf('[')));
  return j?.[0]?.results ?? [];
}

// the expected version reads from the package itself — the test survives a
// version bump without editing this line (the release flow bumps both)
const { readFileSync } = await import('node:fs');
const EXPECTED_VER = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
// ---------- bootstrapping: tables + admin + address ----------
const init = await req('POST', '/api/setup/init', {});
ok('schema initialized', init.status === 200 && init.data?.ok === true, JSON.stringify(init.data).slice(0, 120));

const st = await req('GET', '/api/setup/status');
ok('worker answers on 8791', st.status === 200 && st.data?.ok === true);
ok(`setup status reports ${EXPECTED_VER}`, st.data?.version === EXPECTED_VER, String(st.data?.version));

let cookie = '';
if (!st.data?.admin_created) {
  const cr = await req('POST', '/api/setup/admin', { username: 'chief', password: 'Probe-2026-v32' });
  cookie = cookieOf(cr);
  ok('admin created', cr.status === 200 && !!cookie, `${cr.status} ${JSON.stringify(cr.data).slice(0, 140)}`);
} else {
  const lg = await req('POST', '/api/auth/login', { username: 'chief', password: 'Probe-2026-v32' });
  cookie = cookieOf(lg);
  ok('admin login', lg.status === 200, JSON.stringify(lg.data));
}

// a domain + an address to own the letters
const dom = await req('POST', '/api/setup/domain', { name: 'probe32.test' }, cookie);
ok('domain registered', dom.status === 200 || dom.data?.error === 'domain_exists', JSON.stringify(dom.data));
// a draft domain holds no mailboxes — verify it directly, the way real use does after the DNS loop
const vr = d1("UPDATE domains SET status='verified', active=1, stage=3 WHERE name='probe32.test'");
ok('domain verified', Array.isArray(vr), '');
const addr = await req('POST', '/api/addresses', { local: 'chief', domain: 'probe32.test', kind: 'permanent', ttl_hours: 24, label: 'probe' }, cookie);
ok('address created (or exists)', addr.status === 200 || addr.data?.error === 'address_taken', JSON.stringify(addr.data).slice(0, 120));
const addrId = addr.data?.address?.id ?? (addr.data?.error === 'address_taken'
  ? d1("SELECT id FROM addresses WHERE address='chief@probe32.test'")[0]?.id : null);
ok('address id resolved', !!addrId, String(addrId));
const sendAs = (body) => req('POST', '/api/emails/send', { from_address_id: addrId, ...body }, cookie);

// ---------- print identity ----------
const id1 = await req('GET', '/api/emails/print-identity', null, cookie);
ok('print-identity answers for the owner', id1.status === 200 && id1.data?.ok === true, JSON.stringify(id1.data));
ok('print-identity starts empty', id1.data?.logo === null || id1.data?.logo === '');

const G = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='; // 1x1 png
const badUp = await req('PUT', '/api/admin/settings', { print_logo: 'data:text/html;base64,' + G }, cookie);
ok('invalid logo data-url refused silently', badUp.status === 200, String(badUp.status));
const idBad = await req('GET', '/api/emails/print-identity', null, cookie);
ok('invalid logo NOT stored', !idBad.data?.logo, String(idBad.data?.logo).slice(0, 40));

const up = await req('PUT', '/api/admin/settings', { print_logo: 'data:image/png;base64,' + G }, cookie);
ok('valid logo saved', up.status === 200, JSON.stringify(up.data));
const id2 = await req('GET', '/api/emails/print-identity', null, cookie);
ok('print-identity now carries the logo', String(id2.data?.logo || '').startsWith('data:image/png;base64,'), String(id2.data?.logo || '').slice(0, 40));
const sset = await req('GET', '/api/admin/settings', null, cookie);
ok('settings expose print_logo_set', sset.data?.settings?.print_logo_set === true, JSON.stringify(sset.data?.settings?.print_logo_set));
const rm = await req('PUT', '/api/admin/settings', { print_logo: null }, cookie);
ok('logo removed', rm.status === 200);
const id3 = await req('GET', '/api/emails/print-identity', null, cookie);
ok('print-identity empty again', !id3.data?.logo, String(id3.data?.logo || ''));

// guest must be refused
const noAuth = await req('GET', '/api/emails/print-identity');
ok('print-identity refuses the anonymous', noAuth.status === 401, String(noAuth.status));

// ---------- outgoing attachments ----------
// v3.2.2 budgets: 8 files, 8 MB b64 per file, 24 MB b64 per letter.
// too big (over 8 MB b64) → 413 BEFORE the provider check
const bigB64 = 'A'.repeat(8_500_000);
const big = await sendAs({
  to: 'someone@probe32.test', subject: 'big', text: 'x',
  attachments: [{ filename: 'big.bin', content_type: 'application/octet-stream', content_b64: bigB64 }],
});
ok('oversize attachment → 413 attachment_too_big', big.status === 413 && big.data?.error === 'attachment_too_big', `${big.status} ${JSON.stringify(big.data)}`);

// valid attachment but no provider → 409 (parse accepted, provider missing)
const smallB64 = Buffer.from('hello attachment').toString('base64');
const noProv = await sendAs({
  to: 'someone@probe32.test', subject: 'small', text: 'x',
  attachments: [{ filename: 'note.txt', content_type: 'text/plain', content_b64: smallB64 }],
});
ok('valid attachment accepted, provider missing → 409', noProv.status === 409 && noProv.data?.error === 'sending_not_configured', `${noProv.status} ${JSON.stringify(noProv.data)}`);

// 9 files → server slices to 8 (the composer caps at 8 too) and reaches the provider wall
const five = await sendAs({
  to: 'someone@probe32.test', subject: 'five', text: 'x',
  attachments: Array.from({ length: 9 }, (_, i) => ({ filename: `f${i}.txt`, content_type: 'text/plain', content_b64: smallB64 })),
});
ok('server slices to 8 attachments, provider wall reached', five.status === 409, `${five.status}`);

// no attachments, no provider → same honest 409
const plain = await sendAs({ to: 'someone@probe32.test', subject: 'plain', text: 'x' });
ok('plain send without provider → 409', plain.status === 409 && plain.data?.error === 'sending_not_configured', `${plain.status}`);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
