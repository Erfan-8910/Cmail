// Cmail — storage: the mailbox's fuel gauge (v3.2.2).
// One D1 database is the install's disk. This controller answers the honest
// numbers (usage split by kind, against the admin's quota), takes the quota
// and auto-clean permission from Settings → General, and runs the one-press
// cleanup. Admin-only: the disk is the whole install's, not one guest's.
import { Hono } from 'hono';
import type { Env, AppEnv } from '../util';
import { getSetting, setSetting } from '../util';
import { requireAdmin } from '../auth';
import { report, freeSpace, cfg, usage } from '../storage';

const app = new Hono<AppEnv>();

// the full gauge: usage by kind, quota verdicts, biggest letters, last cleanup
app.get('/', requireAdmin, async (c) => {
  const env = c.env;
  const r = await report(env);
  return c.json({
    ok: true,
    storage: {
      used_bytes: r.used_bytes,
      quota_bytes: r.cfg.quota_bytes,
      quota_mb: r.cfg.quota_mb,
      pct: r.pct,
      low: r.low,
      full: r.full,
      full_at: r.full_at,
      auto_clean: r.cfg.auto_clean,
      warn_pct: r.cfg.warn_pct,
      kinds: r.kinds,
      emails: r.emails,
      attachments: r.attachments,
      stored_attachments: r.stored_attachments,
      biggest: r.biggest,
      last_cleanup: r.last_cleanup,
    },
  });
});

// the admin's quota (10 MB floor — even a tiny install deserves honest math;
// 10 GB ceiling — the paid D1 cap)
app.post('/quota', requireAdmin, async (c) => {
  const body = await c.req.json<{ quota_mb?: number }>().catch(() => null);
  const mb = Math.round(Number(body?.quota_mb ?? 0));
  if (!Number.isFinite(mb) || mb < 10 || mb > 10_000) return c.json({ ok: false, error: 'invalid_request' }, 400);
  await setSetting(c.env, 'storage_quota_mb', String(mb));
  // a raised quota can clear a stale full flag on the spot
  const r = await report(c.env);
  if (!r.full) await setSetting(c.env, 'storage_full_at', '0');
  return c.json({ ok: true, quota_mb: mb });
});

// the auto-clean permission — whether the oldest letters may step aside for
// fresh ones when the disk sits at ≥97% (starred letters always survive)
app.post('/autoclean', requireAdmin, async (c) => {
  const body = await c.req.json<{ on?: boolean }>().catch(() => null);
  if (typeof body?.on !== 'boolean') return c.json({ ok: false, error: 'invalid_request' }, 400);
  await setSetting(c.env, 'storage_auto_clean', body.on ? '1' : '0');
  return c.json({ ok: true, auto_clean: body.on });
});

// one-press cleanup — the same rules as the automatic pass (oldest first,
// never starred, the newest ten untouched), down to 85% of the quota
app.post('/clean', requireAdmin, async (c) => {
  const env = c.env;
  const [c0, u] = await Promise.all([cfg(env), usage(env)]);
  const target = c0.quota_bytes * 0.85 - u.used_bytes;
  if (target <= 0) return c.json({ ok: true, freed: 0, deleted: 0, note: 'already_under_target' });
  const r = await freeSpace(env, target, c0.quota_bytes);
  if (r.deleted > 0) {
    const u2 = await usage(env);
    if (u2.used_bytes <= c0.quota_bytes) await setSetting(env, 'storage_full_at', '0');
  }
  return c.json({ ok: true, freed: r.freed, deleted: r.deleted });
});

// the storage facts the health banner needs ride the health report itself —
// but a tiny weight-free probe lives here too for the settings card's
// low-storage strip when the admin disabled health banners. (Kept one route:
// GET / is cheap enough — no probe route.)

export default app;
