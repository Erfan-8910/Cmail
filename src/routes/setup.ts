// Cmail — setup wizard routes
import { Hono } from 'hono';
import type { Env, AppEnv, SessionUser } from '../util';
import { usernameValid, passwordStrong, hashPassword, uid, now, getSettings, setSetting } from '../util';
import { createSession, setSessionCookie, clientIp, rateLimit } from '../auth';

const app = new Hono<AppEnv>();

// public bootstrap: what still needs configuration
app.get('/status', async (c) => {
  const env = c.env;
  const [adminCount, domainCount, settings] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM domains WHERE active = 1').first<{ n: number }>(),
    getSettings(env, ['sending_provider', 'registration', 'app_name']),
  ]);
  const appName = settings.app_name || 'Cmail';
  return c.json({
    ok: true,
    admin_created: (adminCount?.n ?? 0) > 0,
    domains_configured: (domainCount?.n ?? 0) > 0,
    sending_provider: settings.sending_provider || 'none',
    registration: settings.registration || 'closed',
    app_name: appName,
  });
});

// create the very first admin (only when no user exists)
app.post('/admin', async (c) => {
  const ip = clientIp(c);
  if (!(await rateLimit(c.env, ip, 'setup', 5))) return c.json({ ok: false, error: 'rate_limited' }, 429);

  const existing = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) return c.json({ ok: false, error: 'already_setup' }, 409);

  const body = await c.req.json<{ username?: string; password?: string; display_name?: string }>().catch(() => null);
  const username = (body?.username ?? '').trim();
  const password = body?.password ?? '';
  if (!usernameValid(username)) return c.json({ ok: false, error: 'invalid_username' }, 400);
  if (!passwordStrong(password)) return c.json({ ok: false, error: 'weak_password' }, 400);

  const id = uid('usr_');
  const hash = await hashPassword(password);
  await c.env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, role, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, username, hash, 'admin', (body?.display_name ?? '').slice(0, 60) || null, now()).run();

  await setSetting(c.env, 'setup_done', '1');
  const token = await createSession(c.env, id, c.req.header('User-Agent'), ip);
  setSessionCookie(c, token);
  return c.json({ ok: true, user: { id, username, role: 'admin' } });
});

// add a domain during wizard (admin only, but wizard creates admin first)
import { requireUser } from '../auth';
import { RE_DOMAIN } from '../util';

app.post('/domain', requireUser, async (c) => {
  const user = c.get('user') as { role: string };
  if (user.role !== 'admin') return c.json({ ok: false, error: 'forbidden' }, 403);
  const body = await c.req.json<{ name?: string; label?: string }>().catch(() => null);
  const name = (body?.name ?? '').toLowerCase().trim();
  if (!RE_DOMAIN.test(name)) return c.json({ ok: false, error: 'invalid_domain' }, 400);
  const exists = await c.env.DB.prepare('SELECT id FROM domains WHERE name = ?').bind(name).first();
  if (exists) return c.json({ ok: false, error: 'domain_exists' }, 409);
  const id = uid('dom_');
  await c.env.DB.prepare('INSERT INTO domains (id, name, label, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, name, (body?.label ?? '').slice(0, 80) || null, now()).run();
  return c.json({ ok: true, id, name });
});

export default app;
