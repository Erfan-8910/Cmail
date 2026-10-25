<div align="center">

<img src="public/assets/img/icon-black.png" width="86" alt="Cmail logo" />

# Cmail

**Your liquid-glass mailbox on Cloudflare.**

Temporary & permanent inboxes · notes on emails · built-in 2FA codes vault · multi-domain

`Cloudflare Workers` · `D1` · `Email Routing` · zero servers, zero cost to run

</div>

---

## 🖼️ Screenshots

| Inbox | 2FA Vault |
|---|---|
| ![Inbox](docs/screenshot-inbox.png) | ![Vault](docs/screenshot-vault.png) |

| Daylight theme | Creator |
|---|---|
| ![Light](docs/screenshot-light.png) | ![Mobile](docs/screenshot-mobile.png) |

## ✨ What is Cmail?

Cmail is a self-hosted email platform that runs **entirely on your own Cloudflare account** — no VPS, no database server, no monthly bill. It receives real email through Cloudflare Email Routing, stores it in Cloudflare D1, and wraps it in a fast, liquid-glass interface.

Use it as a **disposable inbox** for signups and verification codes, as your **permanent mailbox** for real correspondence, or both at once — every inbox can be temporary or permanent, labeled, forwarded, and annotated.

### Highlights

| | |
|---|---|
| 📬 **Temporary + permanent inboxes** | Spin up a 1-hour burnable alias or a forever inbox — on any of your domains |
| 🌐 **Multi-domain** | Connect as many domains/subdomains as you like; one worker receives them all |
| 🗒️ **Notes on emails** | Pin a colored personal note to any message — orders, tracking numbers, meeting details |
| 🔐 **2FA vault** | Store named TOTP codes (your built-in authenticator) with live codes, QR export & otpauth import |
| 🛡️ **Account 2FA** | Protect sign-in with TOTP two-factor verification |
| 📤 **Outgoing mail** | Send via Brevo or Resend with one API key |
| ➡️ **Forwarding** | Forward copies of any inbox to a verified address |
| 🧑‍🤝‍🧑 **Multi-user** | Optional open registration; each user sees only their own inboxes |
| 🧹 **Auto-cleanup** | Hourly cron expires temporary inboxes & old mail |
| 🌙 **Liquid-glass UI** | Dark & Daylight themes, adjustable glass transparency, Dynamic Island, full FA/EN + RTL |
| 🧭 **In-app setup wizard** | First visit walks you through admin → domain → sending |
| ⚡ **One-command install** | `bash deploy.sh` does everything |

## 🚀 Install (one command)

> Prerequisites: **Node.js 18+** and a **Cloudflare account** (free plan works).

```bash
git clone https://github.com/Erfan-8910/CMail.git
cd CMail
bash deploy.sh
```

The installer will:

1. install dependencies
2. log you into Cloudflare (`wrangler login`)
3. create the **D1 database** and wire its id into `wrangler.jsonc`
4. apply migrations
5. generate and store a random **APP_SECRET**
6. **deploy the worker**
7. *(optional)* auto-configure **Email Routing** (MX + SPF + catch-all → worker) via the API when you provide `CLOUDFLARE_API_TOKEN`

When it finishes, open the printed `https://cmail.<your-subdomain>.workers.dev` — the **setup wizard** takes over:

1. create the admin account
2. add your domain (exact DNS records shown)
3. optionally connect Brevo/Resend for outgoing mail
4. done ✅

### Manual install

<details>
<summary>Step by step</summary>

```bash
npm install
npx wrangler login

# database
npx wrangler d1 create cmail-db          # copy database_id → wrangler.jsonc
npx wrangler d1 migrations apply cmail-db --remote

# secrets
npx wrangler secret put APP_SECRET       # long random string

# deploy
npx wrangler deploy
```

Then in the Cloudflare dashboard:
**Email Routing → enable → Catch-all address → Action: Send to Worker → `cmail`**

</details>

## 📬 Receiving mail

For each domain you add (Dashboard → **Domains**, or the setup wizard):

1. the domain must be on your Cloudflare account
2. enable **Email Routing** for it (Cloudflare adds `route1/2/3.mx.cloudflare.net` MX + SPF automatically)
3. set **Catch-all → Send to Worker → cmail**

Any address on that domain (`anything@your.domain`) now lands in Cmail.
With **catch-all auto-create** enabled (default), unknown recipients instantly get a temporary inbox — that's your disposable-mail machine. Disable catch-all per domain if you only want explicit inboxes.

## 📤 Sending mail

Settings → **Outgoing mail**: choose **Brevo** or **Resend**, paste the API key, set a verified sender. Test with one click.

## 🔐 Security

- passwords: PBKDF2-SHA256, 100k iterations, per-user salt
- sessions: random tokens, httpOnly SameSite cookies, configurable lifetime
- TOTP secrets: encrypted at rest (AES-256-GCM, HKDF-derived key)
- login rate-limiting per IP, security headers + strict CSP
- email HTML rendered in a fully sandboxed iframe

## 🗺️ Routes

| Method | Endpoint | |
|---|---|---|
| GET | `/api/setup/status` | public bootstrap |
| POST | `/api/setup/admin` | create first admin |
| POST | `/api/auth/login` · `/login/totp` · `/register` · `/logout` | auth |
| GET/POST/PATCH/DELETE | `/api/addresses` · `/api/addresses/domains` | inboxes & domains |
| GET | `/api/emails` · `/api/emails/:id` · `/stats` | mail |
| PUT | `/api/emails/:id/note` | notes |
| POST | `/api/emails/bulk` · `/api/emails/send` | bulk & outgoing |
| GET/POST/PATCH/DELETE | `/api/totp` | 2FA vault |
| GET/PUT | `/api/admin/settings` · `/overview` · `/users` | admin |

## 🧪 Local development

```bash
npm install
npm run db:migrate:local
npm run dev            # http://localhost:8787
```

## 📄 License

MIT © [Erfan-8910](https://github.com/Erfan-8910)

---

<div align="center">

**Cmail** — craft, own, and use your email.
فارسی? [README فارسی](README.fa.md)

</div>
