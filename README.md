<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-white.png">
  <img src="docs/logo-black.png" width="210" alt="Cmail — logo">
</picture>

# Cmail

**A calm, complete mail ecosystem that lives entirely inside your own Cloudflare account.**

Temporary & permanent inboxes · notes on every email · built-in 2FA vault · unlimited domains · outgoing mail · zero servers, zero monthly bills

[![Version](https://img.shields.io/badge/version-2.1.0-4f8f60)](https://github.com/Erfan-8910/Cmail/releases)
[![Deploy](https://img.shields.io/badge/deploy-one%20file%20%2B%20one%20binding-3d7a4f)](#installation)
[![Tables](https://img.shields.io/badge/tables-one%20click-56725c)](#route-2--fully-graphical-zero-commands)
[![License](https://img.shields.io/badge/license-MIT-7c9c6d)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-F38020)](https://workers.cloudflare.com)

**English** · [فارسی](README.fa.md)

</div>

---

## Why Cmail exists

Cmail started from a simple question: **why should anyone pay rent for a mailbox?**

The usual answer involves a rented server, a database you have to babysit, and a monthly invoice you keep forgetting. Cmail throws all of that away. The whole ecosystem runs inside the Cloudflare account you already own: incoming mail arrives through **Email Routing**, everything is stored in **D1** (SQLite at the edge), and the entire interface is served by a single **Worker**. No server to keep alive, no invoice, no rented panel.

What you get instead is a personal space you genuinely own — the domain, the data, the keys. Delete it whenever you like, move it whenever you like. That is the whole point.

And because a mailbox alone is never enough, Cmail behaves like an **ecosystem** rather than an inbox: burner addresses for signups, permanent boxes for real work, a colored note under any message, a built-in 2FA vault, and outgoing mail from your own domain — all inside one calm, glassy panel.

## Highlights

| | |
|---|---|
| 📬 **Temporary + permanent inboxes** | Disposable addresses with a live countdown and adjustable TTL, and permanent ones that are simply yours forever. |
| 🌐 **Unlimited domains** | Attach every domain on your Cloudflare account — one Worker receives them all, each with a live health chip. |
| 🗒️ **Notes on emails** | A colored personal note under any message — order numbers, tracking links, anything. Search finds it instantly. |
| 👤 **Every inbox is an account** | Each mailbox behaves like a standalone account: its mail, its private notes and its own 2FA codes stay inside that account only. Add one from the account bar like adding a fresh identity. |
| 🔐 **2FA vault** | A built-in authenticator: live 6-digit codes with a countdown ring, encrypted at rest with AES-256-GCM, 77 built-in marks, folders, and per-inbox binding. |
| 🛡️ **Account 2FA** | Signing in itself can be protected with TOTP. |
| 📤 **Outgoing mail** | Connect Brevo or Resend with one API key and send from your own domain. |
| ➡️ **Forwarding** | Mirror copies of any inbox to an address you already check. |
| ⌘ **Command palette** | Press <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> anywhere: jump to anything, run actions, search mail live as you type. |
| ⌨️ **Keyboard-first** | `j`/`k` to move, `Enter` to open, `x` to select, `s` to star — the full map lives inside the app. |
| 🧹 **Auto-cleanup** | An hourly cron expires temporary inboxes and purges old mail on its own. |
| 🌙 **Liquid-glass UI** | Dark & Daylight themes, adjustable glass transparency, 13 named color moods, Persian (RTL) + English. |
| 📱 **Truly responsive** | From a 320px phone to a 1920px desktop — panes fold into drawers and bottom sheets. |
| 🔒 **Your data, your rules** | Your D1, your keys. Nobody else holds your mail. |

## The gallery

<div align="center">

| **The cockpit** — three panes, zero noise, every account one tap away |
|---|
| <img src="docs/screenshot-inbox.png" width="620" alt="Inbox — three panes, account strip, unread badges"> |

| **The reader** — full HTML mail, rendered inside a sandboxed frame, RTL detected on its own |
|---|
| <img src="docs/screenshot-reader.png" width="620" alt="Reader — rendered HTML, plain text toggle, sticky note"> |

| **The vault** — live 6-digit codes, folders, a mark for every key |
|---|
| <img src="docs/screenshot-vault.png" width="620" alt="2FA vault — live codes, folders, glyph marks"> |

| **Mission control** — every domain, one glance, honest health chips |
|---|
| <img src="docs/screenshot-domains.png" width="620" alt="Domains — health chips, catch-all switches, inbox counts"> |

| **One keystroke from anywhere to everywhere** |
|---|
| <img src="docs/screenshot-cmdk.png" width="620" alt="Command palette — navigation, actions, live mail search"> |

| **Thirteen moods, one slider** |
|---|
| <img src="docs/screenshot-settings.png" width="620" alt="Settings — named color moods, glass transparency, security"> |

| **Daylight mode, same calm** |
|---|
| <img src="docs/screenshot-light.png" width="620" alt="Daylight theme, Persian RTL"> |

| **The whole cockpit, in a shirt pocket** |
|---|
| <img src="docs/screenshot-mobile.png" width="300" alt="Mobile inbox"> <img src="docs/screenshot-mobile-mail.png" width="300" alt="Mobile reader"> <img src="docs/screenshot-mobile-fa.png" width="300" alt="Mobile, Persian RTL"> |

| **The front door** |
|---|
| <img src="docs/screenshot-login.png" width="560" alt="Sign-in — centered card, living aurora, recovery guide built in"> |

</div>

## What's new in 2.1 — the quiet-under-the-hood release

- **A leaner, better-documented database.** [`schema.sql`](schema.sql) gained the one index it was missing (`emails(received_at)` — the hourly retention sweep was doing a table scan), and every table and index now carries a comment explaining *why* it exists. All four migrations got proper headers. The schema (11 tables · 15 indexes) is fully idempotent: paste it twice, nothing complains.
- **Two guides instead of one merged file.** This README is the English original; the full Persian guide now lives in [`README.fa.md`](README.fa.md). Same structure, same depth.
- **Fresh screenshots**, taken from the current build — new color moods, domain health chips, vault folders, the works.
- Plus everything 2.0 brought: the entire app embedded in one `worker.js`, one-click table creation from the setup screen, and no more raw `internal server error` — every failure mode answers with a bilingual guide page instead.

<details>
<summary><b>What 2.0 changed (for the curious)</b></summary>

- Everything lives inside `worker.js`: pages, styles, scripts, fonts and icons. No "upload the UI folder", no "Attach assets" step — just **Edit Code + one binding**.
- The setup screen has a **"Create tables automatically"** button: one press runs all 26 schema statements (11 tables, 15 indexes, plus healing statements that repair older databases without touching data).
- A missing binding or missing tables no longer produces a raw error — the Worker answers with a calm bilingual page that says exactly which step is left.
- [`migrations/0004_performance_indexes.sql`](migrations/0004_performance_indexes.sql) tunes the hot paths for installs that predate it.

</details>

## Who is it for?

- **Anyone tired of spam** — instead of handing your real address to every website, mint a one-hour address for each signup and keep your real inbox spotless.
- **Developers and testers** — spin up dozens of test inboxes, catch system emails, try address variants, and let them expire when you are done.
- **Privacy-minded people** — no analytics, no third-party scripts, no CDN calls; everything lives in your account, under your keys.
- **Domain owners** — turn the domains already sitting on your Cloudflare into a complete mail ecosystem. Every domain, unlimited addresses.
- **Anyone who wants their tools to actually belong to them** — set it up once, own it forever.

## Downloads — no clone needed

- **Prebuilt [`worker.js`](https://github.com/Erfan-8910/Cmail/releases/download/v2.1.0/worker.js)** — the entire application in one file (~1.1 MB, ~470 KB gzipped). This is all Route 2 needs.
- **Full package v2.1.0:** [`CMail-v2.1.0.zip`](https://github.com/Erfan-8910/Cmail/releases/download/v2.1.0/CMail-v2.1.0.zip) — sources, `schema.sql`, migrations and scripts. All versions: [Releases](https://github.com/Erfan-8910/Cmail/releases)

## Installation

> Prerequisites: just a **Cloudflare account** (the free plan is plenty). For the terminal routes: Node.js 18+.

### Route 1 — one command (terminal)

```bash
git clone https://github.com/Erfan-8910/CMail.git
cd CMail
bash deploy.sh
```

The installer handles everything: creates the D1 database, applies the schema, generates a strong random `APP_SECRET`, deploys the Worker, and prints your panel URL.

### Route 2 — fully graphical, zero commands

Five steps. No SQL, no folder uploads — only your browser and the Cloudflare dashboard:

**1) Create the database**
- Sign in to [dash.cloudflare.com](https://dash.cloudflare.com) ← **Storage & Databases ← D1 SQL Database ← Create**
- Name it `cmail-db` and create it. That's it — creating tables is Cmail's own job now.

**2) Create the Worker and paste the code**
- **Workers & Pages ← Create ← Workers ← Create Worker**
- Name it `cmail` and **Deploy** once with the default code.
- Click **Edit code**, delete the default code, paste the full content of [`worker.js`](https://github.com/Erfan-8910/Cmail/releases/download/v2.1.0/worker.js) and **Deploy**.

**3) The only binding you need: D1**
- Back on the Worker: **Settings ← Bindings ← Add**
- Type **D1 database** ← variable name: `DB` ← database: `cmail-db` ← Save / Deploy.
- (Optional but recommended) also add a **Secret**: name `APP_SECRET` ← value: a long random string. This is the app's internal encryption key — create it once, never change it.

**4) Schedule the cleanup**
- **Settings ← Trigger Events ← Cron Triggers ← Add** and enter: `17 * * * *`

**5) Done!** Open `https://cmail.<your-subdomain>.workers.dev`:
- With the binding in place you will see a single button — **"Create tables automatically"**. Press it once and every table is built (if something is missing, the same page tells you exactly which step slipped).
- Then it asks you to **choose a username and password**, and walks you through the domain and the outgoing-mail service with step-by-step guides.

> 💡 Shortcut: on **Workers & Pages ← Create** you can connect your GitHub fork instead (Connect to Git) and let Cloudflare build automatically. Replace `REPLACE_WITH_D1_ID` in `wrangler.jsonc` with the real database id first.

### Route 3 — terminal, step by step

<details>
<summary><b>For terminal people</b> (open)</summary>

```bash
git clone https://github.com/Erfan-8910/CMail.git
cd CMail
npm install
npx wrangler login

npx wrangler d1 create cmail-db
#   paste the returned database_id into wrangler.jsonc (REPLACE_WITH_D1_ID)
npx wrangler d1 migrations apply cmail-db --remote
npx wrangler secret put APP_SECRET     # a long random string
npx wrangler deploy
```

The CLI path applies tables as migrations (`0001`–`0004`); to build everything in one shot instead: `npx wrangler d1 execute cmail-db --remote --file=schema.sql`.

Then in the dashboard: your domain ← **Email ← Email Routing** ← enable it ← **Catch-all address ← Action: Send to Worker ← cmail**.

</details>

### Manual tables, the modern way (if ever needed)

<details>
<summary><b>Creating tables by hand with one file</b> (open)</summary>

If you ever need to build the schema outside the app, there is exactly one file: [`schema.sql`](schema.sql). It carries:

- the final shape of all 11 tables (notes, folders and vault-mark columns included);
- full idempotency — every statement is `IF NOT EXISTS`, so running it twice never errors;
- 15 indexes, one per real query path: inbox lists, unread badges, session auth, cron sweeps.

Run it from the D1 **Console** tab in the dashboard (paste → Execute) or from a terminal:

```bash
npx wrangler d1 execute cmail-db --remote --file=schema.sql
```

For older installs that only ever ran `0001`, either apply migrations `0002`/`0003` in order or simply press the one-click button inside the app — its healing statements add any missing columns without errors.

</details>

## Receiving mail: domains & Email Routing

Your domain must use Cloudflare DNS (free plan is fine); a dedicated subdomain like `mail.yourdomain.com` works great. Add the domain in Cmail's **Domains** panel — every domain carries a live health chip that tells you at a glance whether the connection is actually receiving mail. Enabling Email Routing makes Cloudflare add these records for you:

| Record | Value | Notes |
|---|---|---|
| MX | `route1.mx.cloudflare.net` (priority 10) | automatic |
| MX | `route2.mx.cloudflare.net` (priority 20) | automatic |
| MX | `route3.mx.cloudflare.net` (priority 30) | automatic |
| TXT (SPF) | `v=spf1 include:_spf.mx.cloudflare.net ~all` | automatic |

The final and most important step: **Email Routing ← Routing rules ← Catch-all address ← Action: Send to Worker ← cmail**. From that moment **every** address on your domain lands in Cmail — and with catch-all auto-create, unknown recipients instantly become one-hour inboxes. That is your disposable-mail machine, always on.

## Sending mail (optional, but worth it)

Cmail sends through **Brevo** (300 mails/day free) or **Resend** (100/day free): create an account on the provider, verify your sending domain, then in Cmail go to **Settings ← Outgoing mail**, pick the provider, paste the key, set the sender address, and press Test. The API key is stored only in your own D1 — it never leaves your Cloudflare.

## Sign-in, access & your credentials

The panel is **single-user**; there is no registration and no second account. On the very first visit you choose a **username and password**, and from then on they are the only key. If you prefer not to type the username every time, switch **Username at sign-in** off in **Settings ← Security** — from then on the password alone is enough.

Security is taken seriously: passwords are hashed with PBKDF2-SHA256 (100k iterations), sessions ride on httpOnly cookies, the account itself supports TOTP two-factor, and brute-force attempts are rate-limited per IP and per route.

### 🔑 If you lose your password or username

No hunting for docs — **the recovery guide lives right on the sign-in page**: open "Help & account recovery" under the login form and copy the ready SQL statements:

1. Open [dash.cloudflare.com](https://dash.cloudflare.com) ← **Storage & Databases ← D1 ← cmail-db** ← the **Console** tab.
2. Find your **username**:

```sql
SELECT username FROM users;
```

3. **Reset the password** to the temporary value `Recover-Cmail-2026`:

```sql
UPDATE users SET password_hash = 'pbkdf2$100000$Y21haWwtcmVjb3Zlci1zYWx0MQ==$lvVylyVdxsS9Ji19drxw9ko72vDhlyHCDf5dSIC9Z/c=' WHERE role = 'admin';
```

4. Sign in with your username and `Recover-Cmail-2026`, then **immediately** change the password in Settings ← Security. No mail is touched — the statement only replaces the password.

> ⚠️ **Never run `DELETE FROM users`** — deleting the user cascades and wipes all of their inboxes and mail. The UPDATE above is all you need, and change the temporary password right away.

## Everyday use

- **Create an inbox:** pick a domain, type any local part (or hit Random), choose its lifetime — 1 hour, 24 hours, or permanent. Temporary ones show a live countdown and can be extended.
- **Take notes:** open any mail and write into the personal note — five colors, auto-saved, searchable.
- **⌘K:** the palette jumps between pages, runs actions and searches your mail live while you type.
- **The vault:** add codes by name in the 2FA Vault — paste an `otpauth://` secret or import a QR, pick one of the 77 built-in marks, organize into folders. Codes refresh every 30 seconds and copy with one tap.
- **Shortcuts:** `/` search, `j`/`k` move, `Enter` open, `x` select, `s` star, `Esc` back — the full map lives in the Guide.
- **Make it yours:** Dark/Daylight theme, glass transparency, 13 named color moods, and Persian/English — all in Settings.

## Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| Bilingual guide page titled "Database binding is missing" | The D1 binding named `DB` is not set | Installation step 3: Settings ← Bindings ← D1 ← variable `DB` |
| Guide page titled "Tables are not created yet" | Binding works, tables don't exist | Open the home page and press "Create tables automatically" |
| Mail never arrives | Usually the catch-all | Dashboard ← domain ← Email Routing ← Catch-all ← Send to Worker ← `cmail`; the domain's health chip in-app should turn green |
| Outgoing mail fails | Key/sender | Settings ← Outgoing mail ← Test; the sender domain must be verified on the provider |
| A raw Worker error (`1101`) | Should not happen | Every error is converted into the guide page; if you ever see a raw one, the text inside the page is enough to report it — `npx wrangler tail` gives live logs |
| The page does not load at all | Dashboard/service issue | Check [cloudflarestatus.com](https://www.cloudflarestatus.com) |

## FAQ

<details>
<summary><b>How do I update Cmail?</b></summary>

Two paths. If you installed via **Route 2**, just paste the new `worker.js` into Edit Code and Deploy — the database structure is repaired by the "Create tables automatically" button on the setup screen (it only adds missing columns and indexes; it never touches your data). If you installed via **Route 1/3**: `git pull` and `npx wrangler deploy` (migrations apply with `npx wrangler d1 migrations apply cmail-db --remote`).
</details>

<details>
<summary><b>Can I use several domains?</b></summary>

Yes — enable each domain on Cloudflare, add it under Domains, point its catch-all to the worker. Inboxes across all domains work instantly.
</details>

<details>
<summary><b>Where does my data live? Can I back it up?</b></summary>

Everything is in your single D1 database. You can export a full SQL snapshot from the dashboard at any time — that is your backup.
</details>

<details>
<summary><b>worker.js is large — is that a problem?</b></summary>

No. It is ~1.1 MB because the entire interface (including logos and fonts) is embedded; after the gzip compression Cloudflare applies automatically it shrinks to ~470 KB and sits comfortably inside the free-plan limits. In exchange there are no separate files and no extra bindings to configure.
</details>

## Under the hood

```
                     ┌──────────────────────────────────────────┐
                     │               Cloudflare                  │
 incoming mail       │                                           │
 SMTP ──────────►  Email Routing (MX)                            │
                     │        │ catch-all                        │
                     │        ▼                                  │
 browser ────────►  Worker ── serves embedded UI (single file)   │
                     │   │  │                                    │
                     │   │  └── Brevo / Resend ──► outgoing mail │
                     │   ▼                                       │
                     │  D1 (SQLite) — mail · inboxes · account   │
                     │               · notes · TOTP · settings   │
                     └──────────────────────────────────────────┘
```

One Worker serves the UI, the API, the incoming-mail handler and the hourly cleanup cron. One D1 database holds everything. And since 2.0 the UI itself is part of the Worker bundle, so deployments are atomic: paste one file, and interface and backend always match.

**Database map** — what each table owns:

| Table | Purpose |
|---|---|
| `users` | The admin account, PBKDF2 password hash, optional TOTP secret (sealed) |
| `sessions` | Login sessions (token, expiry, UA/IP for the session list) |
| `domains` | Connected domains, catch-all switch, activity |
| `addresses` | Inboxes — permanent or temporary (with TTL), optional forwarding, per-inbox notes |
| `emails` | Full messages (text + HTML), read/star flags, retention |
| `attachments` | Binary attachments stored base64 inside the mail row |
| `email_notes` | Colored sticky notes attached to messages |
| `totp_entries` | 2FA keys — AES-256-GCM sealed, optional mark, optional inbox binding, folders |
| `totp_folders` | User-managed vault folders |
| `settings` | App configuration (sending provider, login mode, app secret) |
| `auth_attempts` | Rate-limit counters per IP and route |

**Request lifecycle highlights**

- `GET /` and `/assets/*` — answered straight from the bundle with ETags; nothing external is fetched, ever (the CSP only allows `self`).
- `POST /api/setup/init` — runs the embedded schema statements in order; refuses once an admin exists, safe to repeat otherwise.
- `POST` to the Worker (Email Routing) — parses MIME, stores mail, auto-creates unknown catch-all inboxes as temporary ones.
- `scheduled` (cron `17 * * * *`) — expires temporary inboxes, prunes old mail and stale sessions.

## License

MIT © [Erfan-8910](https://github.com/Erfan-8910)

---

<div align="center">

**Cmail** — *your mailbox, your rules.* 🌿

*Build it. Own it. Never pay rent for an inbox again.* ✨

[فارسی](README.fa.md) · [Releases](https://github.com/Erfan-8910/Cmail/releases) · [License](LICENSE)

</div>
