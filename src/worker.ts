// Cmail — Cloudflare Worker entry
// API (Hono) + incoming email handler + scheduled cleanup + fully
// self-contained UI (every asset is embedded in the bundle — the worker
// serves its own interface, so deployment needs nothing but this file
// and one D1 binding).
import { Hono } from 'hono';
import type { Env, AppEnv, SessionUser } from './util';
import { attachUser } from './auth';
import { handleEmail, scheduledCleanup } from './emailin';
import { ASSET_FILES } from './generated/assets';
import { diagnosticResponse } from './diag';
import setupRoutes from './routes/setup';
import authRoutes from './routes/auth';
import addressRoutes from './routes/addresses';
import emailRoutes from './routes/emails';
import totpRoutes from './routes/totp';
import mailfolderRoutes from './routes/mailfolders';
import adminRoutes from './routes/admin';
import shareRoutes from './routes/share';

const app = new Hono<AppEnv>();

// ---------- security headers ----------
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // v3.1.0: HSTS everywhere — the panel is HTTPS-only by nature (Workers),
  // the header makes the browser refuse to even try plain HTTP next time
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // modern companion of X-Frame-Options — covers the browsers that dropped
  // the legacy header, on API answers too
  c.header('Content-Security-Policy', [
    "frame-ancestors 'self'",
  ].join('; '));
  if (!c.req.path.startsWith('/api')) {
    // the full CSP applies to the UI shell — merged with the frame-ancestors
    // directive above by the browser (the strictest of each wins)
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
        "frame-ancestors 'self'",
      ].join('; ')
    );
  }
});

// ---------- embedded UI ----------
function asset(name: string): Response | null {
  const f = ASSET_FILES[name];
  if (!f) return null;
  const headers: Record<string, string> = {
    'Content-Type': f.type,
    ETag: f.tag,
    // fonts never change → cache them for good. Revalidating them on every
    // load (the old no-cache) made late font swaps reflow the whole page on
    // slow networks — one of the real causes of the "page jump" reports.
    'Cache-Control': f.type === 'font/woff2' ? 'public, max-age=31536000, immutable'
      : f.type.startsWith('image/') ? 'public, max-age=86400'
      : 'no-cache',
  };
  const body: BodyInit = f.text !== undefined ? f.text : Uint8Array.from(atob(f.b64!), (ch) => ch.charCodeAt(0));
  return new Response(body, { status: 200, headers });
}

app.get('/', (c) => {
  const hit = asset('index.html');
  if (hit && c.req.header('If-None-Match') === hit.headers.get('ETag')) return c.body(null, 304);
  return hit ?? c.text('Not found', 404);
});
app.get('/index.html', (c) => asset('index.html') ?? c.text('Not found', 404));
app.get('/manifest.json', (c) => asset('manifest.json') ?? c.text('Not found', 404));
app.get('/assets/*', (c) => {
  let name = '';
  try { name = decodeURIComponent(new URL(c.req.url).pathname); } catch { return c.text('Bad request', 400); }
  // '/assets/css/app.css' → 'assets/css/app.css' (keys are paths relative to public/)
  name = name.replace(/^\/+/, '');
  const hit = asset(name);
  if (!hit) return c.text('Not found', 404);
  if (c.req.header('If-None-Match') === hit.headers.get('ETag')) return c.body(null, 304);
  return hit;
});

// ---------- api ----------
app.use('/api/*', attachUser);

// v3.1.1 — CSRF defense in depth. The session cookie is SameSite=Lax (which
// already keeps cross-site POSTs from carrying it in every modern browser);
// this check is the second wall: a browser that DID attach the cookie to a
// cross-site write (old browser, Lax-plus-GET quirks) still fails here,
// because its Origin/Referer names another site. Non-browser clients (curl,
// scripts with Bearer tokens) send neither header and walk through.
app.use('/api/*', async (c, next) => {
  const m = c.req.method.toUpperCase();
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    const src = c.req.header('Origin') || c.req.header('Referer');
    if (src) {
      try {
        if (new URL(src).host !== new URL(c.req.url).host) {
          return c.json({ ok: false, error: 'forbidden' }, 403);
        }
      } catch {
        return c.json({ ok: false, error: 'forbidden' }, 403);
      }
    }
  }
  await next();
});

// v3.1.1 — THE LOCK IS THE SERVER'S. When the session row carries
// locked_at > 0, every data endpoint refuses (403 session_locked) — mail,
// vault codes, attachments, send, folders, addresses, admin, shares. Only
// the surfaces the lock screen itself needs stay open:
//   /api/auth/me            → the boot check that re-draws the lock
//   /api/auth/lock          → idempotent re-lock (never turns a lock off)
//   /api/auth/verify-unlock → the credential check that turns it off
//   /api/auth/logout        → the way out
//   /api/setup/*            → public pre-auth bootstrap, no user data
//   /api/health             → the liveness probe
// Deleting the overlay, clearing sessionStorage, editing JS — nothing in the
// browser changes the session row: the data simply never leaves the worker.
const LOCK_EXEMPT = [
  '/api/auth/me',
  '/api/auth/lock',
  '/api/auth/verify-unlock',
  '/api/auth/logout',
  '/api/health',
];
app.use('/api/*', async (c, next) => {
  const u = c.get('user') as SessionUser | null;
  if (u?.locked) {
    const p = c.req.path;
    const exempt = LOCK_EXEMPT.includes(p) || p.startsWith('/api/setup/');
    if (!exempt) return c.json({ ok: false, error: 'session_locked' }, 403);
  }
  await next();
});

app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

app.route('/api/setup', setupRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/addresses', addressRoutes);
app.route('/api/emails', emailRoutes);
app.route('/api/totp', totpRoutes);
app.route('/api/mail-folders', mailfolderRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/share', shareRoutes);

app.get('/api/health', (c) => c.json({ ok: true, service: 'cmail', time: Date.now() }));

// api 404
app.all('/api/*', (c) => c.json({ ok: false, error: 'not_found' }, 404));

// ---------- fallbacks ----------
app.notFound((c) => {
  if (c.req.method === 'GET' && !c.req.path.startsWith('/api')) {
    return asset('index.html') ?? c.text('Not found', 404);
  }
  return c.text('Not found', 404);
});

// API errors stay JSON; pages get the styled diagnostics page.
app.onError((err, c) => {
  if (c.req.path.startsWith('/api')) {
    return c.json(
      { ok: false, error: 'server_error', detail: String(err?.message ?? err).slice(0, 200) },
      500
    );
  }
  return diagnosticResponse(c.req.raw, c.env, err);
});

// ---------- exports ----------

export default {
  // last-resort net: even a broken deployment shows guidance, never a bare
  // "internal server error". (try/catch for synchronous throws, .catch for
  // async rejections — both layers matter.)
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => {
    try {
      return (app.fetch(req, env, ctx) as Promise<Response>).catch((e: unknown) => diagnosticResponse(req, env, e));
    } catch (e) {
      return diagnosticResponse(req, env, e);
    }
  },

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
