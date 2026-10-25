// Cmail — admin: overview, users, settings
import { Hono } from 'hono';
import type { Env, AppEnv, SessionUser } from '../util';
import { uid, now, clean, getSettings, setSetting, hashPassword, passwordStrong, RE_LOCAL_PART, randomLocalPart } from '../util';
import { requireAdmin } from '../auth';
import { testProvider } from '../emailout';

const app = new Hono<AppEnv>();

app.get('/overview', requireAdmin, async (c) => {
  const [users, addresses, emails, temp, storage, domains, notes, totp] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM addresses').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM emails').first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM addresses WHERE kind='temp'").first<{ n: number }>(),
    c.env.DB.prepare('SELECT COALESCE(SUM(size),0) AS n FROM emails').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM domains WHERE active=1').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM email_notes').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM totp_entries').first<{ n: number }>(),
  ]);
  return c.json({
    ok: true,
    overview: {
      users: users?.n ?? 0, addresses: addresses?.n ?? 0, emails: emails?.n ?? 0,
      temp_addresses: temp?.n ?? 0, storage_bytes: storage?.n ?? 0,
      domains: domains?.n ?? 0, notes: notes?.n ?? 0, totp_entries: totp?.n ?? 0,
    },
  });
});

app.get('/users', requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.display_name, u.created_at, u.last_login_at, u.totp_enabled,
       (SELECT COUNT(*) FROM addresses a WHERE a.user_id = u.id) AS addresses,
       (SELECT COUNT(*) FROM emails e WHERE e.user_id = u.id) AS emails
     FROM users u ORDER BY u.created_at`
  ).all();
  return c.json({ ok: true, users: results ?? [] });
});

app.patch('/users/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ role?: string; password?: string; display_name?: string }>().catch(() => null);
  const row = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);
  if (body?.role && ['admin', 'user'].includes(body.role)) {
    await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(body.role, id).run();
  }
  if (body?.password) {
    if (!passwordStrong(body.password)) return c.json({ ok: false, error: 'weak_password' }, 400);
    await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(body.password), id).run();
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  }
  if (body?.display_name !== undefined) await c.env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(clean(body.display_name, 60) || null, id).run();
  return c.json({ ok: true });
});

app.delete('/users/:id', requireAdmin, async (c) => {
  const me = c.get('user') as { id: string };
  const id = c.req.param('id');
  if (id === me.id) return c.json({ ok: false, error: 'cannot_delete_self' }, 400);
  const admins = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").first<{ n: number }>();
  const target = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(id).first<{ role: string }>();
  if (target?.role === 'admin' && (admins?.n ?? 0) <= 1) return c.json({ ok: false, error: 'last_admin' }, 400);
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

app.get('/settings', requireAdmin, async (c) => {
  const s = await getSettings(c.env, [
    'app_name', 'login_username', 'temp_ttl_default', 'max_addresses', 'session_days',
    'sending_provider', 'sending_api_key', 'sending_from_email', 'sending_from_name', 'retention_days',
  ]);
  return c.json({
    ok: true,
    settings: {
      app_name: s.app_name || 'Cmail',
      login_username: (s.login_username ?? '1') !== '0',
      temp_ttl_default: parseInt(s.temp_ttl_default ?? '24', 10) || 24,
      max_addresses: parseInt(s.max_addresses ?? '50', 10) || 50,
      session_days: parseInt(s.session_days ?? '30', 10) || 30,
      sending_provider: s.sending_provider || 'none',
      sending_api_key_set: !!s.sending_api_key,
      sending_from_email: s.sending_from_email || '',
      sending_from_name: s.sending_from_name || 'Cmail',
      retention_days: parseInt(s.retention_days ?? '0', 10) || 0,
    },
  });
});

app.put('/settings', requireAdmin, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ ok: false, error: 'bad_request' }, 400);

  if (body.app_name !== undefined) await setSetting(c.env, 'app_name', clean(String(body.app_name), 40) || 'Cmail');
  if (body.login_username !== undefined) await setSetting(c.env, 'login_username', body.login_username ? '1' : '0');
  if (body.temp_ttl_default !== undefined) await setSetting(c.env, 'temp_ttl_default', String(Math.min(8760, Math.max(1, parseInt(String(body.temp_ttl_default), 10) || 24))));
  if (body.max_addresses !== undefined) await setSetting(c.env, 'max_addresses', String(Math.min(1000, Math.max(1, parseInt(String(body.max_addresses), 10) || 50))));
  if (body.session_days !== undefined) await setSetting(c.env, 'session_days', String(Math.min(365, Math.max(1, parseInt(String(body.session_days), 10) || 30))));
  if (body.retention_days !== undefined) await setSetting(c.env, 'retention_days', String(Math.min(3650, Math.max(0, parseInt(String(body.retention_days), 10) || 0))));

  if (body.sending_provider !== undefined) {
    const provider = String(body.sending_provider);
    if (['none', 'brevo', 'resend'].includes(provider)) await setSetting(c.env, 'sending_provider', provider);
  }
  if (body.sending_api_key) await setSetting(c.env, 'sending_api_key', clean(String(body.sending_api_key), 200));
  if (body.sending_from_email !== undefined) await setSetting(c.env, 'sending_from_email', clean(String(body.sending_from_email), 120));
  if (body.sending_from_name !== undefined) await setSetting(c.env, 'sending_from_name', clean(String(body.sending_from_name), 60) || 'Cmail');

  return c.json({ ok: true });
});

app.post('/test-send', requireAdmin, async (c) => {
  const body = await c.req.json<{ to?: string }>().catch(() => null);
  const to = clean(body?.to, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return c.json({ ok: false, error: 'invalid_email' }, 400);
  const res = await testProvider(c.env, to);
  if (!res.ok) return c.json({ ok: false, error: res.error }, 502);
  return c.json({ ok: true });
});

// maintenance: purge everything older than retention now
app.post('/cleanup', requireAdmin, async (c) => {
  const { scheduledCleanup } = await import('../emailin');
  await scheduledCleanup(c.env);
  return c.json({ ok: true });
});

export default app;
