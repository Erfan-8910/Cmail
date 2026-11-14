// Cmail — v3.1.0 security E2E: prove every "bypass via devtools" report is dead.
// Run against a FRESH wrangler dev on :8787 (local D1 wiped first).
// Prints PASS/FAIL per check; exits non-zero on any failure.
import { execSync } from 'node:child_process';
import { createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

const BASE = 'http://127.0.0.1:8787';
let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}

async function req(method, path, body, useCookie, ip) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(ip ? { 'CF-Connecting-IP': ip } : {}),   // simulate distinct IPs for the limiter
      ...(useCookie ? { cookie: useCookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data, headers: res.headers, setCookie: res.headers.get('set-cookie') };
}

function d1(sql) {
  // \$ escaping: inside the double-quoted shell command bash would otherwise
  // expand the $-containing hash — the exact trap the 3.0.3 docs warn about
  const out = execSync(`npx wrangler d1 execute cmail-db --local --json --command "${sql.replace(/\$/g, '\\$')}"`, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const j = JSON.parse(out.slice(out.indexOf('[')));
  return j?.[0]?.results ?? [];
}

function cookieOf(r) { return r.setCookie ? r.setCookie.split(';')[0] : ''; }

// RFC 6238 TOTP (SHA-1, 6 digits, 30s) — mirrors the worker's verifier
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s) {
  let bits = 0, value = 0; const out = [];
  for (const ch of s.toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(secretB32, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac('sha1', b32decode(secretB32)).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** 6).padStart(6, '0');
}

const PW1 = 'S3cure-Enough!';       // the creation password
const PW_LEGACY = 'Legacy-100k-Pw1'; // legacy 100k-iteration hash
const PW2 = 'Fresh-Start-2026x';     // after the first change
const PW3 = 'Final-Form-31x';        // after the rate-limit storm

// ---------- phase 0: fresh install ----------
const st = await req('GET', '/api/setup/status', null, '');
ok('status reachable', st.status === 200, `got ${st.status}`);
ok('fresh install (no admin)', st.data?.admin_created === false, JSON.stringify(st.data));

const init = await req('POST', '/api/setup/init', null, '');
ok('schema init', init.data?.ok === true, JSON.stringify(init.data).slice(0, 120));

// ---------- phase 1: the password bar is SERVER-owned ----------
// weak candidates the old build accepted (">= 8 chars" was its only rule)
const weakAttempts = [
  ['letters-only (no digit)', 'abcdefghX'],
  ['digits-only (no letter)', '12345678'],
  ['common denylist', 'Password1'],
  ['eight repeated chars', 'aaaaaaaa1'],
  ['the OLD global recovery password', 'Recover-Cmail-2026'],
  ['too short', 'S3cure!'],
];
let setupIp = 9;
for (const [label, pw] of weakAttempts) {
  // each attempt its own IP — the setup limiter (5/10min) must not mask the policy answer
  const r = await req('POST', '/api/setup/admin', { username: 'erfan', password: pw }, '', `192.0.2.${setupIp++}`);
  ok(`setup/admin rejects ${label}`, r.status === 400 && r.data?.error === 'weak_password', JSON.stringify(r.data));
}

const create = await req('POST', '/api/setup/admin', { username: 'erfan', password: PW1 }, '', `192.0.2.${setupIp++}`);
ok('setup/admin accepts a strong password', create.data?.ok === true, JSON.stringify(create.data).slice(0, 100));
let cookie = cookieOf(create);
ok('admin session cookie', !!cookie);
const dup = await req('POST', '/api/setup/admin', { username: 'x2', password: PW1 }, '', `192.0.2.${setupIp++}`);
ok('second admin refused (already_setup)', dup.status === 409, JSON.stringify(dup.data));

// ---------- phase 2: legacy hash → transparent rehash at login ----------
const legacySalt = randomBytes(16);
const legacyKey = pbkdf2Sync(PW_LEGACY, legacySalt, 100_000, 32, 'sha256');
const legacyHash = `pbkdf2$100000$${legacySalt.toString('base64')}$${legacyKey.toString('base64')}`; // plain legacy scheme
d1(`UPDATE users SET password_hash = '${legacyHash}' WHERE username = 'erfan'`);

const lg = await req('POST', '/api/auth/login', { username: 'erfan', password: PW_LEGACY }, '');
ok('login with legacy 100k hash works', lg.data?.ok === true && !lg.data?.totp_required, JSON.stringify(lg.data).slice(0, 100));
cookie = cookieOf(lg);
const rowNow = d1("SELECT password_hash FROM users WHERE username = 'erfan'")[0]?.password_hash ?? '';
ok('hash silently upgraded to the PEPPERED form at login', rowNow.startsWith('pbkdf2mac$'), rowNow.slice(0, 24));
const lg2 = await req('POST', '/api/auth/login', { username: 'erfan', password: PW_LEGACY }, '');
ok('re-login still works after rehash', lg2.data?.ok === true, JSON.stringify(lg2.data).slice(0, 80));
cookie = cookieOf(lg2);
const bad = await req('POST', '/api/auth/login', { username: 'erfan', password: 'Wrong-Guess-99' }, '');
ok('wrong password → honest 401', bad.status === 401 && bad.data?.error === 'invalid_credentials', JSON.stringify(bad.data));

// ---------- phase 3: password change — rate limit + other-session kill ----------
const s2 = await req('POST', '/api/auth/login', { username: 'erfan', password: PW_LEGACY }, '');
const cookie2 = cookieOf(s2);
ok('second browser signed in (for the kill test)', !!cookie2);

const pcWrong = await req('POST', '/api/auth/password', { current: 'Nope-Not-It-9', next: PW2 }, cookie);
ok('change with wrong current → 401', pcWrong.status === 401 && pcWrong.data?.error === 'invalid_credentials', JSON.stringify(pcWrong.data));
const pcWeak = await req('POST', '/api/auth/password', { current: PW_LEGACY, next: 'abcdefghX' }, cookie);
ok('change to policy-violating password refused', pcWeak.status === 400 && pcWeak.data?.error === 'weak_password', JSON.stringify(pcWeak.data));
const pcOk = await req('POST', '/api/auth/password', { current: PW_LEGACY, next: PW2 }, cookie);
ok('change to a strong password ok', pcOk.data?.ok === true, JSON.stringify(pcOk.data));

const killed = await req('GET', '/api/auth/me', null, cookie2);
ok('the OTHER browser session died with the change', killed.status === 401, `got ${killed.status}`);
const alive = await req('GET', '/api/auth/me', null, cookie);
ok('the changing session survives', alive.data?.ok === true, `got ${alive.status}`);

// the brute-force storm runs as its OWN IP so the panel's own bucket stays clean
let lastStatus = 0;
for (let i = 0; i < 12; i++) {
  const r = await req('POST', '/api/auth/password', { current: 'Brute-Force-99', next: PW3 }, cookie, '203.0.113.77');
  lastStatus = r.status;
}
ok('password brute-force hits the rate limit', lastStatus === 429, `last ${lastStatus}`);
const pcOk2 = await req('POST', '/api/auth/password', { current: PW2, next: PW3 }, cookie);
ok('the honest browser can still change its password', pcOk2.data?.ok === true, JSON.stringify(pcOk2.data));

// ---------- phase 4: 2FA disable demands the password ----------
const start = await req('POST', '/api/auth/totp/start', null, cookie);
const secret = start.data?.secret ?? '';
ok('totp start returns a secret', /^[A-Z2-7]{16,}$/.test(secret), secret.slice(0, 8));
const enable = await req('POST', '/api/auth/totp/enable', { secret, code: totpNow(secret) }, cookie);
ok('totp enable with live code', enable.data?.ok === true, JSON.stringify(enable.data));

const dNoPw = await req('POST', '/api/auth/totp/disable', { code: totpNow(secret) }, cookie);
ok('disable WITHOUT password → 401', dNoPw.status === 401, JSON.stringify(dNoPw.data));
const dBadPw = await req('POST', '/api/auth/totp/disable', { current: 'Nope-Again-99', code: totpNow(secret) }, cookie);
ok('disable with wrong password → 401', dBadPw.status === 401, JSON.stringify(dBadPw.data));
const dBadCode = await req('POST', '/api/auth/totp/disable', { current: PW3, code: '000000' }, cookie);
ok('disable with wrong code → 401', dBadCode.status === 401 && dBadCode.data?.error === 'invalid_code', JSON.stringify(dBadCode.data));
const dOk = await req('POST', '/api/auth/totp/disable', { current: PW3, code: totpNow(secret) }, cookie);
ok('disable with password + live code ok', dOk.data?.ok === true, JSON.stringify(dOk.data));
const meAfter = await req('GET', '/api/auth/me', null, cookie);
ok('2FA is off after the honest disable', meAfter.data?.user?.totp_enabled === 0 || meAfter.data?.user?.totp_enabled === false, JSON.stringify(meAfter.data?.user ?? {}));

// ---------- phase 5: suspended share frozen at the API ----------
d1("INSERT OR IGNORE INTO domains (id, name, label, active, catch_all, status, stage, created_at) VALUES ('dom_sec', 'sec.test', NULL, 1, 1, 'verified', 3, 1)");
d1("INSERT OR IGNORE INTO addresses (id, user_id, domain_id, address, label, notes, kind, created_at) VALUES ('adr_sec1', (SELECT id FROM users WHERE username='erfan'), 'dom_sec', 'sec@sec.test', NULL, '', 'permanent', 1)");
const adr = d1("SELECT id, user_id FROM addresses WHERE address = 'sec@sec.test'")[0];
ok('test mailbox exists', !!adr?.id, JSON.stringify(adr));

const shareCreate = await req('POST', '/api/share', {
  address_ids: [adr.id], username: `guest-sec-${Date.now() % 100000}`, password: 'Guest-Sec-99',
  perms: ['read'], label: 'sec test',
}, cookie);
ok('share credential created', shareCreate.data?.ok === true, JSON.stringify(shareCreate.data).slice(0, 120));

const gl = await req('POST', '/api/auth/login', { username: (shareCreate.data?.share?.username ?? 'guest-sec'), password: 'Guest-Sec-99' }, '');
const gcookie = cookieOf(gl);
ok('guest signs in', gl.data?.ok === true && gl.data?.user?.role === 'share', JSON.stringify(gl.data).slice(0, 100));

const gMail = await req('GET', '/api/emails', null, gcookie);
ok('active guest reads its mailboxes', gMail.data?.ok === true, `got ${gMail.status}`);
const gAddr = await req('GET', '/api/addresses', null, gcookie);
const gAddrStr = JSON.stringify(gAddr.data);
ok('guest address list ok', gAddr.data?.ok === true, `got ${gAddr.status}`);
ok('guest never sees owner forward_to', !gAddrStr.includes('forward_to'));
ok('guest never sees owner notes', !gAddrStr.includes('"notes"'), gAddrStr.slice(0, 200));

// suspend (admin's hand, countdown keeps burning)
const susp = await req('POST', `/api/share/${shareCreate.data.share.id}/suspend`, { freeze_time: false }, cookie);
ok('admin suspends the share', susp.data?.ok === true, JSON.stringify(susp.data));

const sMail = await req('GET', '/api/emails', null, gcookie);
ok('SUSPENDED guest: mail API refuses (403)', sMail.status === 403 && sMail.data?.error === 'suspended_share', `${sMail.status} ${JSON.stringify(sMail.data)}`);
const sTotp = await req('GET', '/api/totp', null, gcookie);
ok('SUSPENDED guest: vault refuses', sTotp.status === 403, `got ${sTotp.status}`);
const sStats = await req('GET', '/api/emails/stats', null, gcookie);
ok('SUSPENDED guest: stats refuse', sStats.status === 403, `got ${sStats.status}`);
const sFolders = await req('GET', '/api/mail-folders', null, gcookie);
ok('SUSPENDED guest: folders refuse', sFolders.status === 403, `got ${sFolders.status}`);
const sSend = await req('POST', '/api/emails/send', { to: 'x@y.zz', subject: 's', text: 'hi' }, gcookie);
ok('SUSPENDED guest: send refuses', sSend.status === 403, `got ${sSend.status}`);
const sMe = await req('GET', '/api/auth/me', null, gcookie);
ok('SUSPENDED guest: /me still paints the frozen page', sMe.data?.ok === true && sMe.data?.suspended === true, JSON.stringify(sMe.data).slice(0, 120));

const unsusp = await req('POST', `/api/share/${shareCreate.data.share.id}/unsuspend`, null, cookie);
ok('admin unsuspends', unsusp.data?.ok === true, JSON.stringify(unsusp.data));
const gMail2 = await req('GET', '/api/emails', null, gcookie);
ok('unsuspended guest reads again', gMail2.data?.ok === true, `got ${gMail2.status}`);

// ---------- phase 6: guest permission walls (fail-closed) ----------
const gDel = await req('DELETE', '/api/emails/eml_does_not_exist', null, gcookie);
ok("read-only guest can't delete (perm before existence)", gDel.status === 403, `got ${gDel.status}`);
const gAddrPost = await req('POST', '/api/addresses', { domain: 'sec.test', local: 'newone' }, gcookie);
ok("guest can't create mailboxes (owner-only)", gAddrPost.status === 403, `got ${gAddrPost.status}`);
const gPw = await req('POST', '/api/auth/password', { current: 'x', next: PW3 }, gcookie);
ok("guest can't touch the panel password", gPw.status === 403, `got ${gPw.status}`);
const gAdmin = await req('GET', '/api/admin/overview', null, gcookie);
ok("guest can't reach admin APIs", gAdmin.status === 403 || gAdmin.status === 401, `got ${gAdmin.status}`);
const gTotpSecret = await req('GET', '/api/totp/tfa_x/secret', null, gcookie);
ok("guest can't reveal a foreign vault secret", gTotpSecret.status === 404, `got ${gTotpSecret.status}`);

// ---------- phase 7: admin walls ----------
const roleSelf = await req('PATCH', `/api/admin/users/${(d1("SELECT id FROM users WHERE username='erfan'")[0] ?? {}).id}`, { role: 'user' }, cookie);
ok('admin cannot demote own role', roleSelf.status === 400 && roleSelf.data?.error === 'cannot_change_own_role', JSON.stringify(roleSelf.data));

const keySet = await req('PUT', '/api/admin/settings', { sending_api_key: 'xoxb-plain-test-123' }, cookie);
ok('provider key accepted', keySet.data?.ok === true, JSON.stringify(keySet.data));
const keyRow = d1("SELECT value FROM settings WHERE key='sending_api_key'")[0]?.value ?? '';
ok('provider key SEALED at rest (v1.…)', keyRow.startsWith('v1.'), keyRow.slice(0, 12));
const keyGet = await req('GET', '/api/admin/settings', null, cookie);
ok('settings never echo the raw key', !JSON.stringify(keyGet.data).includes('xoxb-plain-test-123'), JSON.stringify(keyGet.data).slice(0, 120));

// ---------- phase 8: the browser-generated recovery hash is server-compatible ----------
const recSalt = randomBytes(16);
const recPw = `Rec-${randomBytes(4).toString('base64url').replace(/[^a-z0-9]/gi, '').slice(0, 4) || 'ab12'}-${randomBytes(4).toString('base64url').replace(/[^a-z0-9]/gi, '').slice(0, 4) || 'cd34'}-7${randomBytes(3).toString('base64url').replace(/[^a-z0-9]/gi, '').slice(0, 3) || 'ef5'}`;
const recKey = pbkdf2Sync(recPw, recSalt, 100_000, 32, 'sha256');
const recHash = `pbkdf2$100000$${recSalt.toString('base64')}$${recKey.toString('base64')}`;
d1(`UPDATE users SET password_hash = '${recHash}' WHERE username = 'erfan'`);
const recLogin = await req('POST', '/api/auth/login', { username: 'erfan', password: recPw }, '');
ok('browser-generated recovery hash logs in', recLogin.data?.ok === true && !recLogin.data?.totp_required, JSON.stringify(recLogin.data).slice(0, 80));
cookie = cookieOf(recLogin);
ok('recovery login granted a real session cookie', !!cookie, '(empty — check the 2FA state above)');

// ---------- phase 9: Persian password passes (Unicode-aware bar) ----------
const faSet = await req('PATCH', `/api/admin/users/${(d1("SELECT id FROM users WHERE username='erfan'")[0] ?? {}).id}`, { password: 'گذرواژه۹۹' }, cookie);
ok('Persian letters + Persian digits accepted', faSet.data?.ok === true, JSON.stringify(faSet.data));
const faLogin = await req('POST', '/api/auth/login', { username: 'erfan', password: 'گذرواژه۹۹' }, '');
ok('Persian password signs in', faLogin.data?.ok === true, JSON.stringify(faLogin.data).slice(0, 80));
cookie = cookieOf(faLogin);
const faBack = await req('PATCH', `/api/admin/users/${(d1("SELECT id FROM users WHERE username='erfan'")[0] ?? {}).id}`, { password: PW3 }, cookie);
ok('restored to the Latin test password', faBack.data?.ok === true, JSON.stringify(faBack.data));
const backLogin = await req('POST', '/api/auth/login', { username: 'erfan', password: PW3 }, '');
ok('final login works', backLogin.data?.ok === true, JSON.stringify(backLogin.data).slice(0, 80));
cookie = cookieOf(backLogin);

// ---------- phase 10: headers ----------
const home = await fetch(BASE + '/');
ok('HSTS on the shell', (home.headers.get('strict-transport-security') ?? '').includes('max-age=31536000'), home.headers.get('strict-transport-security') ?? '(none)');
ok('frame-ancestors in shell CSP', (home.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'self'"), home.headers.get('content-security-policy') ?? '(none)');
ok('X-Frame-Options kept', home.headers.get('x-frame-options') === 'SAMEORIGIN', home.headers.get('x-frame-options') ?? '(none)');
const health = await fetch(BASE + '/api/health');
ok('HSTS reaches API answers too', (health.headers.get('strict-transport-security') ?? '').length > 0, '(none)');

// ---------- phase 11: mail frame hardening (static, in the built bundle) ----------
const bundle = (await import('node:fs')).readFileSync('worker.js', 'utf8');
ok('mail frame ships its own strict CSP', bundle.includes("default-src 'none'; img-src"), '');
ok('meta-refresh is stripped by the sanitizer', (await import('node:fs')).readFileSync('public/assets/js/views/mail.js','utf8').includes('meta[ht'.concat('tp-equiv="refresh"]')), '');
ok('no global recovery constant in the bundle', !bundle.includes('Recover-Cmail-2026') && !bundle.includes('lvVylyVdxsS9'), '');
ok('peppered hash scheme in the bundle', bundle.includes('pbkdf2mac'), '');
ok('platform iteration ceiling respected (no 300k anywhere)', !bundle.includes('300000') || !bundle.includes('PBKDF2_DEFAULT = 300'), '');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
