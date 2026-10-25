// Cmail — Cloudflare Worker entry
// API (Hono) + incoming email handler + scheduled cleanup + static assets
import { Hono } from 'hono';
import type { Env, AppEnv } from './util';
import { attachUser, destroySession, tokenFrom } from './auth';
import { handleEmail, scheduledCleanup } from './emailin';
import setupRoutes from './routes/setup';
import authRoutes from './routes/auth';
import addressRoutes from './routes/addresses';
import emailRoutes from './routes/emails';
import totpRoutes from './routes/totp';
import adminRoutes from './routes/admin';

const app = new Hono<AppEnv>();

// ---------- security headers ----------
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (!c.req.path.startsWith('/api')) {
    c.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https: http:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-src 'self' data: about:",
        "object-src 'none'",
        "base-uri 'self'",
      ].join('; ')
    );
  }
});

// ---------- api ----------
app.use('/api/*', attachUser);
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

app.route('/api/setup', setupRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/addresses', addressRoutes);
app.route('/api/emails', emailRoutes);
app.route('/api/totp', totpRoutes);
app.route('/api/admin', adminRoutes);

app.get('/api/health', (c) => c.json({ ok: true, service: 'cmail', time: Date.now() }));

// api 404
app.all('/api/*', (c) => c.json({ ok: false, error: 'not_found' }, 404));

// ---------- spa fallback (non-api GET) ----------
app.notFound(async (c) => {
  if (c.req.method === 'GET' && !c.req.path.startsWith('/api')) {
    return c.env.ASSETS.fetch(new Request(new URL('/', c.req.url).toString(), { method: 'GET' }));
  }
  return c.text('Not found', 404);
});

// ---------- exports ----------

export default {
  fetch: app.fetch,

  // Cloudflare Email Routing receiver
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext) {
    try {
      await handleEmail(message, env);
    } catch (e) {
      console.error('email handler failed:', e);
      message.setReject('Cmail failed to process this message');
    }
  },

  // hourly: expire temp inboxes, retention, session hygiene
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    try {
      await scheduledCleanup(env);
    } catch (e) {
      console.error('scheduled cleanup failed:', e);
    }
  },
};
