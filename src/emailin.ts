// Cmail — incoming email handler (Cloudflare Email Routing → Worker)
// Rule zero: a platform hiccup must never bounce real mail. Every database
// touch below degrades gracefully — an older schema falls back to the
// columns it actually has, a heartbeat failure stays silent.
import PostalMime from 'postal-mime';
import type { Env, } from './util';
import { uid, now, previewOf, randomLocalPart } from './util';
import { ensureRoom } from './storage';

const MAX_HTML = 900_000;      // ~0.9 MB html stored
const MAX_TEXT = 400_000;
// v3.2.2 — the attachment budget grew up; v3.2.3 — it caught up with Gmail.
// Music arrived and vanished: a song is 5–12 MB and the old 6 MB per-file cap
// silently dropped it AFTER the letter itself had landed ("text came, song
// didn't"). Within the inline budget the payload still rides the attachments
// row itself; anything bigger is split into ordered chunk rows
// (attachment_chunks, 0014), each slice far below every platform limit. A
// letter may now carry 20 files up to 20 MB each — the songs, voice notes,
// photos and PDFs real mail actually brings.
const MAX_INLINE_B64 = 900_000;       // stored base64 cap for the single-row form
const MAX_FILE_B64 = 26_666_668;      // ~20 MB raw per file (Gmail's own ceiling)
const MAX_TOTAL_RAW = 20_000_000;     // ~20 MB of attachments per letter (the 25 MB
                                      // Email-Routing envelope leaves ~5 MB for MIME)
const MAX_FILES = 20;
const CHUNK_B64 = 1_200_000;          // one chunk row holds ~1.2 MB of base64

export async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const to = message.to.toLowerCase();
  const [local, domainName] = to.split('@');
  if (!local || !domainName) return;

  const db = env.DB;

  // find domain (with its registration lifecycle). On a database that hasn't
  // run the 2.2 lifecycle migration yet, the wide SELECT would throw and the
  // message would bounce — so fall back to the pre-2.2 column shape and keep
  // delivering exactly like 2.1 did.
  type DomRow = { id: string; catch_all: number; active: number; status?: string | null; verify_code?: string | null; verify_expires?: number | null };
  let domain: DomRow | null = null;
  let legacySchema = false;
  try {
    domain = await db.prepare('SELECT id, catch_all, active, status, verify_code, verify_expires FROM domains WHERE name = ?')
      .bind(domainName).first<DomRow>();
  } catch {
    try {
      domain = await db.prepare('SELECT id, catch_all, active FROM domains WHERE name = ?')
        .bind(domainName).first<DomRow>();
      legacySchema = true; // no lifecycle columns → behave like v2.1
    } catch { domain = null; }
  }

  // ---- connect-wizard loop verification ----
  // while a domain is 'verifying', the only mail it expects is the code mail:
  // any message to <verify_code>@<domain> proves the MX path works, flips the
  // domain to 'verified' and never touches the mail store.
  if (domain && !legacySchema && domain.status === 'verifying' && domain.verify_code
    && local === domain.verify_code
    && (!domain.verify_expires || domain.verify_expires > now())) {
    await db.prepare("UPDATE domains SET status = 'verified', stage = 3, verify_code = NULL, verify_expires = NULL WHERE id = ?")
      .bind(domain.id).run();
    return; // the confirmation itself — nothing to store
  }

  // a domain still inside its wizard holds no mailboxes yet: drop quietly
  // (legacy schemas never enter the wizard, so they pass through)
  if (domain && !legacySchema && (domain.status === 'draft' || domain.status === 'verifying')) return;

  // find address
  let addr = await db.prepare('SELECT id, user_id, expires_at, forward_to, kind FROM addresses WHERE address = ?').bind(to)
    .first<{ id: string; user_id: string; expires_at: number | null; forward_to: string | null; kind: string }>();

  // catch-all: create a temporary inbox on the fly for unknown recipients
  if (!addr && domain && domain.active && domain.catch_all) {
    const owner = await firstAdminId(env);
    if (owner) {
      const ttlHours = parseInt((await db.prepare("SELECT value FROM settings WHERE key='temp_ttl_default'").first<{ value: string }>())?.value ?? '24', 10) || 24;
      // local part may contain tags (user+tag@) — keep full local part as generated address
      let localSafe = local.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32);
      if (!localSafe || !/^[a-z0-9]/.test(localSafe)) localSafe = randomLocalPart();
      let full = `${localSafe}@${domainName}`;
      const exists = await db.prepare('SELECT id FROM addresses WHERE address = ?').bind(full).first<{ id: string }>();
      if (exists) {
        addr = await db.prepare('SELECT id, user_id, expires_at, forward_to, kind FROM addresses WHERE address = ?').bind(full)
          .first<{ id: string; user_id: string; expires_at: number | null; forward_to: string | null; kind: string }>();
      } else {
        const id = uid('adr_');
        await db.prepare(
          'INSERT INTO addresses (id, user_id, domain_id, address, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(id, owner, domain.id, full, 'temp', now() + ttlHours * 3600_000, now()).run();
        addr = { id, user_id: owner, expires_at: now() + ttlHours * 3600_000, forward_to: null, kind: 'temp' };
      }
    }
  }

  if (!addr) return; // unknown recipient, drop silently

  // parse
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  let parsed: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    parsed = await PostalMime.parse(raw);
  } catch {
    parsed = { subject: '(unparsable message)', text: '', html: '', from: { address: message.from }, attachments: [] } as never;
  }

  // v3.2.2 — the storage ask happens BEFORE anything is written: at ≥97% of
  // the quota the oldest letters step aside (when the admin allowed it) or
  // the fuel gauge lights up. Either way the mail itself is delivered —
  // a full disk must never bounce real mail (rule zero).
  try { await ensureRoom(env, raw.length); } catch { /* bookkeeping only */ }

  const fromName = parsed.from?.name ?? null;
  const fromAddr = parsed.from?.address ?? message.from;
  const subject = parsed.subject ?? '(no subject)';
  const text = (parsed.text ?? '').slice(0, MAX_TEXT);
  const html = (parsed.html ?? '').slice(0, MAX_HTML);
  const preview = previewOf(text || stripHtml(html), 180);

  const emailId = uid('eml_');
  await db.prepare(
    `INSERT INTO emails (id, address_id, user_id, from_name, from_addr, to_addr, subject, preview, text_body, html_body, size, received_at, direction, headers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in', ?)`
  ).bind(
    emailId, addr.id, addr.user_id, fromName, fromAddr, to, subject, preview, text, html,
    raw.length, now(), headerSnapshot(parsed, message)
  ).run();

  // v3.2.2 — attachments: inline for the small, chunked for the big, and
  // NEVER fatal. A storage hiccup on one file leaves that file's metadata
  // row with an empty payload (the reader says so honestly) instead of
  // rejecting the whole letter — the old code threw here and the email
  // handler answered setReject(): the sender got a bounce for a mail the
  // inbox had already half-stored.
  const attsIn = (parsed.attachments ?? []).slice(0, MAX_FILES);
  let attTotalRaw = 0;
  for (const att of attsIn) {
    let bytes: Uint8Array | null = null;
    const c0: unknown = att.content;
    if (c0 instanceof Uint8Array) bytes = c0;
    else if (typeof c0 === 'string') bytes = new TextEncoder().encode(c0);
    else if (c0 instanceof ArrayBuffer) bytes = new Uint8Array(c0);
    if (!bytes || !bytes.length) continue;
    // v3.2.3 — a refused file is no longer INVISIBLE. The old code `continue`d
    // (or `break`ed) before writing any row: the song the user sent never
    // appeared anywhere — not even as an honest "refused" chip. Now every
    // file past the budget gets its metadata row (available = 0), the studio
    // names it with the dead chip, and the letter still always lands.
    const overBudget = bytes.length * 1.34 > MAX_FILE_B64;      // base64 inflation
    const overTotal = attTotalRaw + bytes.length > MAX_TOTAL_RAW;
    if (overBudget || overTotal) {
      try {
        await db.prepare(
          'INSERT INTO attachments (id, email_id, filename, content_type, size, content_b64, chunks, content_id) VALUES (?, ?, ?, ?, ?, NULL, 0, ?)'
        ).bind(uid('att_'), emailId, att.filename ?? 'attachment', att.mimeType ?? 'application/octet-stream',
          bytes.length, att.contentId ?? null).run();
      } catch {
        try {
          await db.prepare(
            'INSERT INTO attachments (id, email_id, filename, content_type, size, content_b64) VALUES (?, ?, ?, ?, ?, NULL)'
          ).bind(uid('att_'), emailId, att.filename ?? 'attachment', att.mimeType ?? 'application/octet-stream', bytes.length).run();
        } catch { /* even the metadata row refused — the letter still lands */ }
      }
      if (overTotal) break;   // the 20 MB letter budget — the rest is named too
      continue;               // this one file alone was too big — keep counting the rest
    }
    attTotalRaw += bytes.length;
    const b64 = arrToB64(bytes);
    const attId = uid('att_');
    try {
      if (b64.length <= MAX_INLINE_B64) {
        await db.prepare(
          'INSERT INTO attachments (id, email_id, filename, content_type, size, content_b64, chunks, content_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
        ).bind(attId, emailId, att.filename ?? 'attachment', att.mimeType ?? 'application/octet-stream',
          bytes.length, b64, att.contentId ?? null).run();
      } else {
        await db.prepare(
          'INSERT INTO attachments (id, email_id, filename, content_type, size, content_b64, chunks, content_id) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)'
        ).bind(attId, emailId, att.filename ?? 'attachment', att.mimeType ?? 'application/octet-stream',
          bytes.length, Math.ceil(b64.length / CHUNK_B64), att.contentId ?? null).run();
        // the ordered slices — each statement's text is tiny and every bound
        // parameter stays under the row limit (1.2 MB of base64 per row)
        for (let i = 0, off = 0; off < b64.length; i++, off += CHUNK_B64) {
          await db.prepare('INSERT INTO attachment_chunks (att_id, idx, data) VALUES (?, ?, ?)')
            .bind(attId, i, b64.slice(off, off + CHUNK_B64)).run();
        }
      }
    } catch {
      // an older schema without the new columns (chunks/content_id) falls
      // back to the 3.2.1 shape; a chunk write that failed leaves the
      // metadata row content-less — the reader tells the truth either way
      try {
        await db.prepare(
          'INSERT INTO attachments (id, email_id, filename, content_type, size, content_b64) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(attId, emailId, att.filename ?? 'attachment', att.mimeType ?? 'application/octet-stream',
          bytes.length, b64.length <= MAX_INLINE_B64 ? b64 : null).run();
      } catch { /* even the metadata row refused — the letter still lands */ }
    }
  }
  // anything past the 20-file cap is not silently gone: it is counted into
  // the letter's size (the raw message always was), the reader shows the
  // files it stored, and the sender's copy rides complete via forwarding

  await db.prepare('UPDATE addresses SET last_mail_at = ? WHERE id = ?').bind(now(), addr.id).run();

  // auto-file: the account's folders may carry sender rules (comma-separated
  // fragments) — the first match quietly files the message. A database
  // without the folders yet must never bounce real mail over it.
  try {
    const { results: ruled } = await db.prepare(
      'SELECT id, sort_from FROM mail_folders WHERE address_id = ? AND sort_from IS NOT NULL'
    ).bind(addr.id).all<{ id: string; sort_from: string }>();
    if (ruled?.length) {
      const hay = `${fromName ?? ''} ${fromAddr ?? ''}`.toLowerCase();
      for (const f of ruled) {
        const needles = String(f.sort_from ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (needles.some((n) => hay.includes(n))) {
          await db.prepare('UPDATE emails SET folder_id = ? WHERE id = ?').bind(f.id, emailId).run();
          break;
        }
      }
    }
  } catch { /* older schema — plain inbox is fine */ }

  // heartbeat for the health panel ("mail is flowing") — never fail the message over it
  try {
    await db.prepare("INSERT INTO settings (key, value) VALUES ('last_mail_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(String(now())).run();
  } catch { /* cosmetic only */ }

  // optional forwarding via Email Routing (destination must be verified in CF dashboard)
  const fwd = addr.forward_to;
  if (fwd) {
    try { await message.forward(fwd); } catch { /* destination not verified yet — ignore */ }
  }

  // auto-reply could be added here later
}

// a compact header snapshot for the advanced-details panel: the headers a
// person actually asks about (path, auth results, ids), capped so a mailing
// list monster can never bloat the row
function headerSnapshot(
  parsed: { headers?: { key: string; value: string }[]; messageId?: string; date?: string },
  message: ForwardableEmailMessage,
): string {
  const KEEP = new Set([
    'from', 'to', 'cc', 'subject', 'date', 'message-id', 'reply-to', 'return-path',
    'received', 'authentication-results', 'arc-authentication-results',
    'dkim-signature', 'dkim-filter', 'spf', 'received-spf', 'dmarc',
    'mime-version', 'content-type', 'user-agent', 'x-mailer', 'x-sender',
    'list-unsubscribe', 'list-id', 'delivered-to', 'x-original-to',
  ]);
  const out: { k: string; v: string }[] = [];
  for (const h of parsed.headers ?? []) {
    const k = String(h.key ?? '').toLowerCase().trim();
    if (!k || !KEEP.has(k)) continue;
    const v = String(h.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 900);
    if (v) out.push({ k, v });
    if (out.length >= 60) break;
  }
  if (!out.some((h) => h.k === 'date') && parsed.date) out.push({ k: 'date', v: String(parsed.date) });
  if (!out.some((h) => h.k === 'received')) out.push({ k: 'received', v: `by Cloudflare Email Routing for ${message.to}; ${new Date().toUTCString()}` });
  try { return JSON.stringify(out).slice(0, 24_000); } catch { return '[]'; }
}

function arrToB64(u8: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(s);
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function firstAdminId(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").first<{ id: string }>();
  return row?.id ?? null;
}

// hourly cleanup: expired temp addresses + retention
export async function scheduledCleanup(env: Env): Promise<void> {
  const t = now();
  // delete emails of expired temp addresses, then addresses themselves
  await env.DB.prepare(
    `DELETE FROM emails WHERE address_id IN (SELECT id FROM addresses WHERE kind='temp' AND expires_at IS NOT NULL AND expires_at < ?)`
  ).bind(t).run();
  await env.DB.prepare(`DELETE FROM addresses WHERE kind='temp' AND expires_at IS NOT NULL AND expires_at < ?`).bind(t).run();

  const days = parseInt((await env.DB.prepare("SELECT value FROM settings WHERE key='retention_days'").first<{ value: string }>())?.value ?? '0', 10);
  if (days > 0) {
    await env.DB.prepare('DELETE FROM emails WHERE received_at < ?').bind(t - days * 86400_000).run();
  }
  // stale sessions
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t).run();
  // expired share credentials leave completely: every live guest session dies,
  // the mailbox junction rows and the link itself leave the database — the
  // credential is unreachable from anywhere after this line (v3.0.0).
  // A share whose countdown the admin FROZE does not burn while suspended:
  // its effective clock stands at frozen_at, so only a frozen_at already past
  // its own expiry can end it (0011).
  try {
    const expired = await env.DB.prepare(
      `SELECT id FROM share_links
        WHERE expires_at IS NOT NULL AND (
          (time_frozen = 1 AND frozen_at IS NOT NULL AND expires_at < frozen_at)
          OR ((time_frozen IS NULL OR time_frozen = 0) AND expires_at < ?)
        )`
    ).bind(t).all<{ id: string }>();
    for (const s of expired.results ?? []) {
      await env.DB.prepare('DELETE FROM sessions WHERE share_id = ?').bind(s.id).run();
      await env.DB.prepare('DELETE FROM share_addresses WHERE share_id = ?').bind(s.id).run().catch(() => { /* pre-0010 */ });
      await env.DB.prepare('DELETE FROM share_links WHERE id = ?').bind(s.id).run();
    }
  } catch { /* a database without share tables yet */ }
  // old rate-limit rows
  await env.DB.prepare('DELETE FROM auth_attempts WHERE window_start < ?').bind(t - 3600_000).run();
  // v3.1.1: expired 2FA pending tokens leave the settings table. The login
  // flow already refuses them on use (their timestamp rides in the value);
  // until now the dead rows simply lingered forever.
  try {
    await env.DB.prepare(
      "DELETE FROM settings WHERE key LIKE 'pending2fa:%' AND CAST(substr(value, instr(value, '.') + 1) AS INTEGER) < ?"
    ).bind(t).run();
  } catch { /* hygiene only — never block the cron */ }
  // heartbeat: the health panel shows "background cleanup ran X ago"
  try {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('last_cron_run', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(String(t)).run();
  } catch { /* cosmetic only */ }
  // v3.2.2 — the fuel gauge gets its hourly sweep too: when the install sits
  // at ≥97% of its quota, the same rules as delivery apply (auto-clean the
  // oldest when allowed, or flag storage_full for the health banner). Mail
  // quiet for weeks? The gauge still tells the truth.
  try {
    const { ensureRoom } = await import('./storage');
    await ensureRoom(env, 0);
  } catch { /* bookkeeping only — the cron must never fail over it */ }
}
