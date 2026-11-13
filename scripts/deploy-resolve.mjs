#!/usr/bin/env node
// Cmail — self-healing, instance-aware deploy: resolves the D1 binding for
// THIS install (one Worker + one database per install), then deploys.
//
// The full story this script exists to kill:
// - The public repo ships wrangler.jsonc with REPLACE_WITH_D1_ID — no real
//   database id ever lives in a public repo, so a plain `wrangler deploy`
//   inside CI dies with error 10021 ("binding DB of type d1 must have a
//   valid `database_id`").
// - The Deploy-to-Cloudflare button provisions resources and rewrites ids
//   ONLY for resources it creates itself; a database whose NAME already
//   exists in the target account is silently reused. Every install shipped
//   the same fixed names (worker "cmail", database "cmail-db"), so a second
//   install was bound to the first install's live data — login screen,
//   mixed mail, the works.
//
// What this script does about it, in order:
// 1. Reads the Worker name (top-level "name") — the install's identity. The
//    button pipeline stamps the name you picked into the config, so it is
//    the one thing that is always unique per install.
// 2. Derives the database THIS install owns: CMAIL_DB_NAME if set, else
//    `<worker-name>-db`. Named after the Worker → no two installs can ever
//    share a database.
// 3. Resolves the binding to that database:
//    - a placeholder / invalid id is resolved by name (find or create);
//    - a real id pointing at a DIFFERENT database (the button reused
//      "cmail-db"?) is re-bound to the install's own database;
//    - lookups try `wrangler d1 list`, then the live Worker's own current
//      bindings, then creation itself — so a CI token that may create
//      resources but not list them still succeeds.
// 4. Patches the working copy of wrangler.jsonc (database name, database id
//    and a CMAIL_DB_NAME marker var) and hands over to `wrangler deploy`.
//
// The working copy is patched in place and never committed — the repo keeps
// the placeholder, exactly as it should.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const CONFIG = 'wrangler.jsonc';
const PLACEHOLDER = 'REPLACE_WITH_D1_ID';
const UUID_RE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

const ACC = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const TOK = process.env.CLOUDFLARE_API_TOKEN || '';
const isUuid = (s) => !!s && UUID_RE.test(s);
const run = (cmd) => spawnSync(cmd, { shell: true, encoding: 'utf8' });

function d1Entries(src) {
  // pull every d1 binding out of the jsonc — comments and // lines tolerated
  const arr = src.match(/"d1_databases"\s*:\s*\[([\s\S]*?)\n\s*\]/);
  if (!arr) return [];
  const out = [];
  const re = /\{[^{}]*\}/g;
  let m;
  while ((m = re.exec(arr[1]))) {
    const name = (m[0].match(/"database_name"\s*:\s*"[^"]+"/) || [])[0];
    const id = (m[0].match(/"database_id"\s*:\s*"[^"]*"/) || [])[0];
    const rawName = (m[0].match(/"database_name"\s*:\s*"([^"]+)"/) || [])[1];
    const rawId = (m[0].match(/"database_id"\s*:\s*"([^"]*)"/) || [])[1];
    if (rawName) out.push({ name: rawName, id: rawId || '', raw: m[0] });
  }
  return out;
}

function workerNameOf(src) {
  // the top-level "name" — measured against the file with the d1 block cut
  // out, so a binding-level name key can never shadow the install's identity
  const bare = src.replace(/"d1_databases"\s*:\s*\[[\s\S]*?\n\s*\]/, '');
  const m = bare.match(/"name"\s*:\s*"([^"]+)"/);
  return m ? m[1] : 'cmail';
}

function listDatabases() {
  // returns [{name, uuid}] — or null when listing is impossible (CI tokens
  // are sometimes allowed to create resources but not to list them)
  const j = run('npx wrangler d1 list --json');
  if (j.status === 0) {
    try {
      const rows = JSON.parse(j.stdout);
      if (Array.isArray(rows)) return rows.map((r) => ({ name: r.name, uuid: r.uuid }));
    } catch { /* fall through to text parsing */ }
  }
  const t = run('npx wrangler d1 list');
  const rows = [];
  for (const line of (t.stdout || '').split('\n')) {
    const tokens = line.trim().split(/\s+/).filter((x) => x && !x.startsWith('─') && !x.startsWith('│'));
    const uuid = tokens.find((x) => UUID_RE.test(x));
    const name = tokens.find((x) => !UUID_RE.test(x));
    if (uuid && name) rows.push({ name, uuid });
  }
  return t.status === 0 && rows.length ? rows : null;
}

async function liveBindingId(workerName, targetDb) {
  // last-resort lookup: the LIVE worker's current bindings — but only when
  // the deployed worker carries our own CMAIL_DB_NAME marker naming THIS
  // database. A marker-less binding could be the button's provisioning
  // pointing at somebody else's database; never trust that.
  if (!ACC || !TOK || !workerName) return null;
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACC}/workers/scripts/${encodeURIComponent(workerName)}/settings`,
      { headers: { Authorization: `Bearer ${TOK}` } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const b = (j && j.result && j.result.bindings) || [];
    const marker = b.find((x) => x.type === 'plain_text' && x.name === 'CMAIL_DB_NAME');
    if (!marker || marker.text !== targetDb) return null;
    const d1 = b.find((x) => x.type === 'd1' && x.name === 'DB');
    return d1 && isUuid(d1.id) ? d1.id : null;
  } catch { return null; }
}

function createDatabase(name) {
  // returns the new id — or null when the name is taken ("already exists"
  // prints no id; the caller re-resolves instead of trusting the message)
  const c = run(`npx wrangler d1 create "${name}"`);
  const out = `${c.stdout || ''}\n${c.stderr || ''}`;
  if (c.status !== 0) {
    if (/already exists/i.test(out)) return null;
    console.error(`✖ could not create D1 database "${name}":\n${out.slice(0, 600)}`);
    process.exit(1);
  }
  const id = (out.match(/database_id\s*[=:]\s*"?([a-f0-9-]{36})"?/i) || [])[1]
    || (out.match(UUID_RE) || [])[0];
  return id || null;
}

// ---------------------------------------------------------------------------
async function main() {
  let src = readFileSync(CONFIG, 'utf8');
  const entries = d1Entries(src);
  console.log('▶ Cmail deploy resolver');

  if (!entries.length) {
    console.log('  no d1_databases in config — deploying as-is');
  } else {
    const workerName = workerNameOf(src);
    const targetDb = (process.env.CMAIL_DB_NAME || '').trim() || `${workerName}-db`;
    console.log(`  worker           : ${workerName}`);
    console.log(`  own database     : ${targetDb}${process.env.CMAIL_DB_NAME ? '  (CMAIL_DB_NAME)' : '  (derived from the worker name — this install\'s alone)'}`);
    console.log(`  config says      : database "${entries[0].name}", id ${entries[0].id || '(none)'}`);

    const rows = listDatabases();
    const e = entries[0];
    let id = null;
    let how = '';

    const cfgIdOk = isUuid(e.id) && e.id !== PLACEHOLDER;
    const cfgNameOk = e.name === targetDb;

    if (cfgIdOk && cfgNameOk && rows) {
      const actual = (rows.find((r) => r.uuid === e.id) || {}).name;
      if (actual === targetDb) { id = e.id; how = 'already bound to this install\'s own database — nothing to change'; }
    }
    if (!id && cfgIdOk && cfgNameOk && !rows) {
      id = e.id; how = 'kept the configured id (database list unavailable to double-check the name)';
    }
    if (!id && cfgIdOk) {
      const actual = rows ? (rows.find((r) => r.uuid === e.id) || {}).name : '?';
      console.log(`  ⚠ config points at ${rows ? `"${actual}"` : 'some other database'} — that belongs to a different install.`);
      console.log(`    re-binding to "${targetDb}" so the two can never share data.`);
    }
    if (!id) {
      // find-or-create the install's own database
      if (rows) {
        const found = rows.find((r) => r.name === targetDb);
        if (found) { id = found.uuid; how = `found "${targetDb}" (d1 list) — re-using this install's database`; }
      }
      if (!id) {
        const live = await liveBindingId(workerName, targetDb);
        if (live) { id = live; how = `found "${targetDb}" (the live worker's own binding)`; }
      }
      if (!id) {
        id = createDatabase(targetDb);
        if (id) how = `created "${targetDb}" — this install's own, empty database`;
      }
      if (!id) {
        // the name is taken but no listing path could hand us the id
        const rows2 = listDatabases();
        const found = rows2 && rows2.find((r) => r.name === targetDb);
        if (found) { id = found.uuid; how = `found "${targetDb}" (d1 list, second pass)`; }
      }
      if (!id) {
        const live = await liveBindingId(workerName, targetDb);
        if (live) { id = live; how = `found "${targetDb}" (the live worker's own binding, second pass)`; }
      }
    }

    if (!id) {
      console.error(`✖ could not resolve the id for database "${targetDb}".`);
      console.error('  tried: wrangler d1 list, the live worker\'s own bindings, and creation.');
      console.error('  If this is CI: the build token could neither list nor create D1 databases.');
      console.error(`  Fix: allow D1 Edit for the build token, or run with CMAIL_DB_NAME=${targetDb} where the token has D1 access.`);
      process.exit(1);
    }

    // patch the working copy: database name, id, and the CMAIL_DB_NAME marker
    let raw = e.raw;
    raw = raw.replace(/"database_name"\s*:\s*"[^"]*"/, `"database_name": "${targetDb}"`);
    if (/"database_id"/.test(raw)) {
      raw = raw.replace(/"database_id"\s*:\s*"[^"]*"/, `"database_id": "${id}"`);
    } else {
      raw = raw.replace(/"database_name"\s*:\s*"[^"]*"/, `"database_name": "${targetDb}",\n      "database_id": "${id}"`);
    }
    src = src.replace(e.raw, raw);
    if (/"vars"\s*:\s*\{/.test(src)) {
      if (/"CMAIL_DB_NAME"/.test(src)) {
        src = src.replace(/"CMAIL_DB_NAME"\s*:\s*"[^"]*"/, `"CMAIL_DB_NAME": "${targetDb}"`);
      } else {
        src = src.replace(/("vars"\s*:\s*\{)/, `$1\n    "CMAIL_DB_NAME": "${targetDb}",`);
      }
    }
    writeFileSync(CONFIG, src);
    console.log(`  ✔ ${how}`);
    console.log(`  ✔ wrangler.jsonc patched → database "${targetDb}" (${id}) — working copy only, nothing is committed`);
  }

  if (process.env.CMAIL_RESOLVE_ONLY === '1') {
    console.log('CMAIL_RESOLVE_ONLY=1 — stopping before the actual deploy');
    return;
  }
  console.log('deploying…');
  const deployNow = () => {
    const d = spawnSync('npx wrangler deploy', { shell: true, encoding: 'utf8' });
    process.stdout.write(d.stdout || '');
    process.stderr.write(d.stderr || '');
    return { status: d.status ?? 1, out: `${d.stdout || ''}\n${d.stderr || ''}` };
  };
  let d = deployNow();
  if (d.status !== 0 && /10072|cron trigger/i.test(d.out)) {
    // free accounts cap cron triggers at 5 per ACCOUNT — a second (or seventh)
    // install can hit that ceiling at the very end of an otherwise perfect
    // deploy: the version uploads, the binding is right, and then the
    // schedules request dies with 10072 and the whole build goes red.
    // Deploying without the hourly cleanup keeps the install alive and the
    // build green — the cleanup is re-attachable the moment a slot frees up.
    console.log('⚠ the hourly-cleanup cron could not be attached — this account has hit the free plan\'s limit of 5 cron triggers (code 10072).');
    let s2 = readFileSync(CONFIG, 'utf8');
    if (/"triggers"\s*:\s*\{/.test(s2)) {
      s2 = s2.replace(/\n\s*"triggers"\s*:\s*\{[^{}]*\},?/, '');
      writeFileSync(CONFIG, s2);
      console.log('  deploying without the cron so this build goes green…');
      const d2 = spawnSync('npx wrangler deploy', { shell: true, stdio: 'inherit' });
      if ((d2.status ?? 1) === 0) {
        console.log('✔ deployed — WITHOUT the hourly cleanup cron (everything else is live).');
        console.log('  The app works fine; automatic cleanups just wait until a cron slot frees up.');
        console.log('  To attach the cleanup later: free a cron slot on this account (or upgrade), then run `npx wrangler deploy` again.');
        process.exit(0);
      }
      process.exit(d2.status ?? 1);
    }
  }
  process.exit(d.status ?? 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
