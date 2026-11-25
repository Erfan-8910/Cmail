// Cmail — the storage engine (v3.2.2).
//
// One D1 database IS the mailbox's disk: bodies, metadata and attachments all
// live inside it, and the platform caps it (500 MB on the free plan, 10 GB
// paid). Until now that disk was invisible — it filled silently, and the
// first symptom was a mail that stopped syncing. This module gives the
// install an honest fuel gauge:
//
//   · usage()      — what is actually stored, split by kind (bodies, images,
//                    audio, video, pdf, archives, documents, other)
//   · quota()/cfg()— the admin's quota (storage_quota_mb) and the auto-clean
//                    permission (storage_auto_clean) from settings
//   · ensureRoom() — called BEFORE an incoming mail is stored: at ≥97% of the
//                    quota it either frees room by deleting the OLDEST letters
//                    (never starred ones, the newest ten are untouchable — and
//                    only when the admin allowed it) or raises the storage_full
//                    flag for the health banners. Delivery itself NEVER bounces
//                    over storage — rule zero stands.
//   · cleanNow()   — the admin's manual one-press cleanup (same rules).
//
// Everything here degrades to "no-op" on a database that has not run the
// 0014 migration yet — a storage hiccup must never become a mail outage.
import type { Env } from './util';
import { now, getSettings, setSetting } from './util';

// the inline budget of one attachments row (raw bytes) — matches emailin.ts
export const INLINE_BUDGET_RAW = 675_000;

export type StorageKind = 'body' | 'image' | 'audio' | 'video' | 'pdf' | 'archive' | 'doc' | 'other';

export const KIND_ORDER: StorageKind[] = ['body', 'image', 'video', 'audio', 'pdf', 'doc', 'archive', 'other'];

// what a content-type (or the absence of one) counts as
export function kindOf(contentType: string | null | undefined): StorageKind {
  const t = String(contentType ?? '').toLowerCase().split(';')[0].trim();
  if (!t) return 'other';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  if (t === 'application/pdf') return 'pdf';
  if (/(zip|rar|7z|tar|gzip|bzip2|x-ace|crdownload)/.test(t)) return 'archive';
  if (t === 'text/html' || t === 'application/xhtml+xml') return 'other';
  if (t.startsWith('text/') || /msword|officedocument|opendocument|rtf|csv|json|xml|calendar/.test(t)) return 'doc';
  return 'other';
}

export type StorageCfg = {
  quota_bytes: number;
  quota_mb: number;
  auto_clean: boolean;
  warn_pct: number;
};

// the free plan's D1 ceiling minus headroom for indexes & metadata — a sane
// default the admin can raise (paid plan) or lower in Settings → General
const DEFAULT_QUOTA_MB = 450;
const WARN_PCT = 80;
const FULL_PCT = 97;      // ensureRoom starts freeing above this
const TARGET_PCT = 85;    // cleanup stops once usage falls under this
const KEEP_NEWEST = 10;   // the newest N letters are never auto-deleted

export async function cfg(env: Env): Promise<StorageCfg> {
  let quota_mb = DEFAULT_QUOTA_MB;
  let auto_clean = true;
  try {
    const s = await getSettings(env, ['storage_quota_mb', 'storage_auto_clean']);
    const q = parseInt(s.storage_quota_mb ?? '', 10);
    if (Number.isFinite(q) && q >= 10 && q <= 10_000) quota_mb = q;
    auto_clean = (s.storage_auto_clean ?? '1') !== '0';
  } catch { /* settings table missing — defaults stand */ }
  return { quota_bytes: quota_mb * 1024 * 1024, quota_mb, auto_clean, warn_pct: WARN_PCT };
}

export type KindRow = { kind: StorageKind; bytes: number; count: number };

export type StorageReport = {
  used_bytes: number;
  pct: number;
  low: boolean;
  full: boolean;
  kinds: KindRow[];
  emails: number;
  attachments: number;
  stored_attachments: number;
  biggest: { id: string; subject: string; from_name: string | null; size: number; received_at: number; att_bytes: number }[];
  last_cleanup: { at: number; freed: number; deleted: number } | null;
  full_at: number | null;
};

// everything the letter bodies occupy (CAST … AS BLOB makes LENGTH return
// bytes, not characters — Persian text counts honestly)
const BODY_BYTES_SQL =
  `COALESCE(SUM(LENGTH(CAST(COALESCE(text_body,'') AS BLOB))
              + LENGTH(CAST(COALESCE(html_body,'') AS BLOB))
              + LENGTH(CAST(COALESCE(preview,'') AS BLOB))), 0)`;

export async function usage(env: Env): Promise<StorageReport> {
  const out: StorageReport = {
    used_bytes: 0, pct: 0, low: false, full: false,
    kinds: [], emails: 0, attachments: 0, stored_attachments: 0,
    biggest: [], last_cleanup: null, full_at: null,
  };
  try {
    const [bodies, counts, kindRows, biggest, flags] = await Promise.all([
      env.DB.prepare(`SELECT ${BODY_BYTES_SQL} AS n FROM emails`).first<{ n: number }>(),
      env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM emails) AS emails,
                (SELECT COUNT(*) FROM attachments) AS att,
                (SELECT COUNT(*) FROM attachments WHERE content_b64 IS NOT NULL OR chunks > 0) AS att_stored`
      ).first<{ emails: number; att: number; att_stored: number }>(),
      // every stored attachment grouped by kind — metadata-only rows
      // (payload refused by the budget) weigh nothing, honestly
      env.DB.prepare(
        `SELECT content_type, size, COUNT(*) AS n FROM attachments
          WHERE content_b64 IS NOT NULL OR chunks > 0 GROUP BY content_type`
      ).all<{ content_type: string | null; size: number; n: number }>(),
      env.DB.prepare(
        `SELECT e.id, e.subject, e.from_name, e.size, e.received_at,
                COALESCE((SELECT SUM(size) FROM attachments a WHERE a.email_id = e.id AND (a.content_b64 IS NOT NULL OR a.chunks > 0)), 0) AS att_bytes
           FROM emails e ORDER BY e.size DESC LIMIT 6`
      ).all<{ id: string; subject: string; from_name: string | null; size: number; received_at: number; att_bytes: number }>(),
      getSettings(env, ['last_storage_cleanup', 'storage_full_at']),
    ]);
    const byKind = new Map<StorageKind, KindRow>();
    const push = (k: StorageKind, bytes: number, count: number) => {
      const row = byKind.get(k) ?? { kind: k, bytes: 0, count: 0 };
      row.bytes += bytes; row.count += count;
      byKind.set(k, row);
    };
    const bodyBytes = bodies?.n ?? 0;
    push('body', bodyBytes, counts?.emails ?? 0);
    for (const r of kindRows.results ?? []) push(kindOf(r.content_type), r.size, r.n);
    out.kinds = KIND_ORDER.filter((k) => byKind.has(k)).map((k) => byKind.get(k)!);
    out.emails = counts?.emails ?? 0;
    out.attachments = counts?.att ?? 0;
    out.stored_attachments = counts?.att_stored ?? 0;
    out.used_bytes = out.kinds.reduce((n, k) => n + k.bytes, 0);
    out.biggest = biggest.results ?? [];
    if (flags.last_storage_cleanup) {
      try { out.last_cleanup = JSON.parse(flags.last_storage_cleanup); } catch { out.last_cleanup = null; }
    }
    out.full_at = flags.storage_full_at ? parseInt(flags.storage_full_at, 10) : null;
  } catch { /* pre-0014 database or empty install — zeros are the honest answer */ }
  return out;
}

// usage() with the quota's verdicts attached — what the health report and the
// storage card both answer from
export async function report(env: Env): Promise<StorageReport & { cfg: StorageCfg }> {
  const [u, c] = await Promise.all([usage(env), cfg(env)]);
  const pct = c.quota_bytes > 0 ? Math.min(100, (u.used_bytes / c.quota_bytes) * 100) : 0;
  return {
    ...u,
    pct: Math.round(pct * 10) / 10,
    low: pct >= c.warn_pct,
    full: pct >= FULL_PCT || (u.full_at !== null && u.full_at > 0),
    cfg: c,
  };
}

export type RoomResult = { freed: number; deleted: number; cleaned: boolean; full: boolean };

// the one place an incoming letter (and the hourly cron) asks for room.
// NEVER throws into the mail path — every failure lands as an honest flag.
export async function ensureRoom(env: Env, needBytes: number): Promise<RoomResult> {
  const out: RoomResult = { freed: 0, deleted: 0, cleaned: false, full: false };
  try {
    const c = await cfg(env);
    if (c.quota_bytes <= 0) return out;
    const u = await usage(env);
    if (u.used_bytes + needBytes <= c.quota_bytes * (FULL_PCT / 100)) {
      // comfortably under — clear any stale full flag
      if (u.full_at) await setSetting(env, 'storage_full_at', '0');
      return out;
    }
    if (!c.auto_clean) {
      out.full = true;
      if (!u.full_at) await setSetting(env, 'storage_full_at', String(now()));
      return out;
    }
    const r = await freeSpace(env, c.quota_bytes * (TARGET_PCT / 100) - u.used_bytes, c.quota_bytes);
    out.freed = r.freed; out.deleted = r.deleted; out.cleaned = r.deleted > 0;
    // room made (or nothing left to delete) — refresh the full flag honestly
    if (out.cleaned) {
      const u2 = await usage(env);
      if (u2.used_bytes + needBytes <= c.quota_bytes) {
        await setSetting(env, 'storage_full_at', '0');
      } else {
        out.full = true;
        await setSetting(env, 'storage_full_at', String(now()));
      }
    } else {
      out.full = true;
      if (!u.full_at) await setSetting(env, 'storage_full_at', String(now()));
    }
  } catch { /* storage bookkeeping must never break delivery */ }
  return out;
}

// delete the OLDEST letters until at least `minFree` bytes are freed. Rules,
// in order: never a starred letter, never the newest KEEP_NEWEST letters,
// always the oldest first, batches of 25 so one pass can never run forever.
export async function freeSpace(env: Env, minFree: number, _quota: number): Promise<{ freed: number; deleted: number }> {
  let freed = 0;
  let deleted = 0;
  if (minFree <= 0) return { freed, deleted };
  for (let round = 0; round < 40 && freed < minFree; round++) {
    const { results } = await env.DB.prepare(
      `SELECT id, size,
              (LENGTH(CAST(COALESCE(text_body,'') AS BLOB))
             + LENGTH(CAST(COALESCE(html_body,'') AS BLOB))
             + LENGTH(CAST(COALESCE(preview,'') AS BLOB))) AS body_bytes
         FROM emails
        WHERE starred = 0
          AND id NOT IN (SELECT id FROM emails ORDER BY received_at DESC LIMIT ${KEEP_NEWEST})
        ORDER BY received_at ASC LIMIT 25`
    ).all<{ id: string; size: number; body_bytes: number }>();
    const rows = results ?? [];
    if (!rows.length) break;
    for (const r of rows) {
      // attachments + chunks ride the FK cascade; the note too
      await env.DB.prepare('DELETE FROM emails WHERE id = ?').bind(r.id).run().catch(() => { /* already gone */ });
      // the mail's own meter plus its letter bodies — an honest upper bound of
      // what the database just gave back
      freed += (r.size ?? 0) + (r.body_bytes ?? 0);
      deleted++;
      if (freed >= minFree) break;
    }
  }
  if (deleted > 0) {
    await setSetting(env, 'last_storage_cleanup', JSON.stringify({ at: now(), freed, deleted }));
  }
  return { freed, deleted };
}
