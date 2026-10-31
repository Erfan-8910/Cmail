<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-white.png">
  <img src="docs/logo-black.png" width="210" alt="Cmail — logo">
</picture>

# Cmail

**A calm, complete mail ecosystem that lives entirely inside your own Cloudflare account.**

Temporary & permanent inboxes · notes on every email · built-in 2FA vault · unlimited domains · outgoing mail · zero servers, zero monthly bills

[![Version](https://img.shields.io/badge/version-2.2.0-4f8f60)](https://github.com/Erfan-8910/Cmail/releases)
[![Deploy](https://img.shields.io/badge/deploy-one%20file%20%2B%20one%20binding-3d7a4f)](#installation)
[![Tables](https://img.shields.io/badge/tables-one%20click%20%2B%20inspector-56725c)](#route-2--fully-graphical-zero-commands)
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
| 🌐 **Domain connect wizard** | Add a domain and it takes your hand: a crisp connect guide, then a verification code you mail to your own domain — mailboxes stay locked until the loop proves itself. |
| 🔎 **D1 inspector** | The setup screen lists every expected table with its row count; build the missing ones with a button, drop the strays, keep your database honest. |
| 🗒️ **Notes on emails** | A colored personal note under any message — order numbers, tracking links, anything. Search finds it instantly. |
| 👤 **Every inbox is an account** | Each mailbox behaves like a standalone account: its mail, its private notes and its own 2FA codes stay inside that account only. |
| 🔐 **2FA vault** | A built-in authenticator: live 6-digit codes with a countdown ring, encrypted at rest with AES-256-GCM, 77 built-in marks, folders, and per-inbox binding. |
| 🛡️ **Account 2FA** | Signing in itself can be protected with TOTP. |
| 📤 **Outgoing mail — optional** | Connect Brevo or Resend with one API key and send from your own domain, with a real test probe. It never gates the rest of the app. |
| ➡️ **Forwarding** | Mirror copies of any inbox to an address you already check. |
| ⌘ **Command palette** | Press <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> anywhere: jump to anything, run actions, search mail live as you type. |
| ⌨️ **Keyboard-first** | `j`/`k` to move, `Enter` to open, `x` to select, `s` to star — the full map lives inside the app. |
| 🧹 **Auto-cleanup** | An hourly cron expires temporary inboxes and purges old mail on its own — the full schedule lives below. |
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

| **Mission control** — every domain, one glance, honest registration states |
|---|
| <img src="docs/screenshot-domains.png" width="620" alt="Domains — status chips, catch-all switches, inbox counts"> |

| **The connect wizard** — one code, one loop mail, and the domain proves itself |
|---|
| <img src="docs/screenshot-wizard.png" width="620" alt="Domain wizard — the loop code, live polling, skip with responsibility"> |

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

## What's new in 2.2 — the release that took domains seriously

- **A connect wizard, start to finish.** Type a domain, press Add, and its wizard opens: a clean walkthrough of the Cloudflare side (enable Email Routing, point Catch-all at the worker) ending at an **"I've connected the domain"** button. Then verification: you get a one-of-a-kind code and send any message from any personal mailbox you own to your own domain. The screen re-checks itself every few seconds, and the moment the worker confirms the mail landed, mailbox creation for that domain unlocks.
- **Leaving is always allowed.** Every wizard stage has an exit, and the exit asks first: **save as a draft, or leave for good?** Drafts wait in the domains table with a Continue button and resume from the exact step you stopped at.
- **No finished registration, no mailbox.** Until the loop confirms the route, creating addresses on that domain is locked. If you know what you are doing, "Skip verification" accepts the responsibility with a straight-face warning.
- **A D1 step on the setup screen, before the account.** Review every expected table with its row count; build anything missing one-by-one or all at once; drop tables that were never part of this app. The expected tables are protected and refuse to be dropped.
- **Outgoing mail is officially optional.** Its row on the setup screen is tagged Optional and can never gate your way into the inbox. A test probe sends a real message to any address you type, so the wiring is proven on the spot.
- **Console-proof SQL.** Reports came in that pasting the files into the D1 Console errored out. The root cause: semicolons inside SQL comments, which derail statement splitters. [`schema.sql`](schema.sql) is now officially console-safe — no semicolons or quotes inside comments, every statement `IF NOT EXISTS`, re-run twice and tested: zero errors. The `migrations/` files are terminal-only, and their headers say so loudly.

<details>
<summary><b>What 2.1 and 2.0 changed (for the curious)</b></summary>

- **2.1** — [`schema.sql`](schema.sql) gained the retention index it was missing, every table and index carries a *why* comment, the guides split into an English original and a full Persian companion, and all screenshots were retaken from the current build.
- **2.0** — the whole app became one file: pages, styles, scripts, fonts and icons all embedded in `worker.js`. No "upload the UI folder", no "Attach assets" — just **Edit Code + one binding**. One-click table creation landed on the setup screen, and every failure mode became a calm bilingual guide page instead of a raw error.

</details>

## Who is it for?

- **Anyone tired of spam** — instead of handing your real address to every website, mint a one-hour address for each signup and keep your real inbox spotless.
- **Developers and testers** — spin up dozens of test inboxes, catch system emails, try address variants, and let them expire when you are done.
- **Privacy-minded people** — no analytics, no third-party scripts, no CDN calls; everything lives in your account, under your keys.
- **Domain owners** — turn the domains already sitting on your Cloudflare into a complete mail ecosystem, with a real wizard instead of tribal knowledge. Every domain, unlimited addresses.
- **Anyone who wants their tools to actually belong to them** — set it up once, own it forever.

## Downloads — no clone needed

- **Prebuilt [`worker.js`](https://github.com/Erfan-8910/Cmail/releases/download/v2.2.0/worker.js)** — the entire application in one file (~1.1 MB, ~470 KB gzipped). This is all Route 2 needs.
- **Full package v2.2.0:** [`CMail-v2.2.0.zip`](https://github.com/Erfan-8910/Cmail/releases/download/v2.2.0/CMail-v2.2.0.zip) — sources, `schema.sql`, migrations and scripts. All versions: [Releases](https://github.com/Erfan-8910/Cmail/releases)

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
- Click **Edit code**, delete the default code, paste the full content of [`worker.js`](https://github.com/Erfan-8910/Cmail/releases/download/v2.2.0/worker.js) and **Deploy**.

**3) The only binding you need: D1**
- Back on the Worker: **Settings ← Bindings ← Add**
- Type **D1 database** ← variable name: `DB` ← database: `cmail-db` ← Save / Deploy.
- (Optional but recommended) also add a **Secret**: name `APP_SECRET` ← value: a long random string. This is the app's internal encryption key — create it once, never change it.

**4) Schedule the cleanup**
- **Settings ← Trigger Events ← Cron Triggers ← Add** and enter: `17 * * * *`

**5) Done!** Open `https://cmail.<your-subdomain>.workers.dev`:
- The **D1 step** opens first: every table with its status. Anything missing gets built with one button — individually or all at once — and stray tables you don't recognize get a clean Drop button.
- Then it asks you to **choose a username and password**, opens the domain connect wizard by itself, and treats outgoing mail as the optional bonus it is — with a test probe whenever you want it.

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

The CLI path applies tables as migrations (`0001`–`0005`); to build everything in one shot instead: `npx wrangler d1 execute cmail-db --remote --file=schema.sql`.

Then in the dashboard: your domain ← **Email ← Email Routing** ← enable it ← **Catch-all address ← Action: Send to Worker ← cmail**.

</details>

### Manual tables — one file, console-proof

<details>
<summary><b>Creating tables by hand from the dashboard</b> (open)</summary>

If you ever need to build the schema outside the app, there is exactly one file: [`schema.sql`](schema.sql). Why it is safe where older files weren't:

- **its comments carry no semicolons and no quotes** — the exact thing that derailed the Console's statement splitter and produced those "errors and won't import" reports;
- **every statement is `IF NOT EXISTS`** — on a fresh, half-built, or already-complete database, pasting it again never errors;
- it carries the final shape of all 11 tables and 15 indexes, domain-lifecycle columns included.

Run it from the dashboard: **Storage & Databases ← D1 ← cmail-db ← Console** ← paste the whole file ← Execute. Done. Interrupted halfway? Paste it again — it picks up exactly where the run left off.

```bash
npx wrangler d1 execute cmail-db --remote --file=schema.sql
```

⚠️ The files under `migrations/` are terminal-only (their headers say so) — do not paste them into the Console. Their `ALTER` statements error on an already-migrated database and abort the whole batch.

</details>

## Domains: from "Add" to "Verified"

Every domain now walks a clear path — guided by a wizard you can leave and resume at will:

1. **Add** — type the domain or subdomain in the Domains panel (or the setup screen), say `mail.yourdomain.com`, press Add.
2. **Connect** — the wizard walks the Cloudflare side step by step: enable Email Routing, the MX records land automatically, Catch-all points at the worker. It ends at **"I've connected the domain"**.
3. **Verify** — you receive a one-of-a-kind code; send any message from a personal mailbox you own to that address (subject and body don't matter). The screen polls every few seconds; when the worker confirms the mail landed, the domain turns green.
4. **Unlocked** — from that moment, creating mailboxes on the domain — permanent or temporary — is open.

All along the way there is an **Exit** button, and pressing it asks: *save as a draft, or leave for good?* Drafts sit in the domains table wearing a "Draft — registration incomplete" chip with a Continue button that reopens the wizard at the saved stage. Until registration completes, mailbox creation stays locked — unless you consciously skip verification and accept the responsibility.

Each domain wears a live status chip: healthy, awaiting first mail, awaiting verification, draft, or verification-skipped. Enabling Email Routing makes Cloudflare add these records for you:

| Record | Value | Notes |
|---|---|---|
| MX | `route1.mx.cloudflare.net` (priority 10) | automatic |
| MX | `route2.mx.cloudflare.net` (priority 20) | automatic |
| MX | `route3.mx.cloudflare.net` (priority 30) | automatic |
| TXT (SPF) | `v=spf1 include:_spf.mx.cloudflare.net ~all` | automatic |

The final and most important step: **Email Routing ← Routing rules ← Catch-all address ← Action: Send to Worker ← cmail**. From that moment **every** address on your domain lands in Cmail.

## Sending mail — optional, with a real test probe

Sending is a bonus, not a gate: its row on the setup screen is tagged **Optional** and it never stands between you and your inbox. When you want it: connect **Brevo** (300 mails/day free) or **Resend** (100/day free) — create the account, verify your sending domain, then in Cmail pick the provider, paste the key, set the sender address. Then press **Test sending**: a real message goes to any address you type and proves the wiring on the spot. The API key is stored only in your own D1 — it never leaves your Cloudflare.

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
| The D1 step marks a table "not built yet" | Binding works, that table doesn't exist | Press **Build** next to it — or **Build the missing tables** above the list |
| Mail never arrives | Usually the catch-all | Dashboard ← domain ← Email Routing ← Catch-all ← Send to Worker ← `cmail`; the domain's chip in-app should turn green |
| "This domain has not finished registration" when creating a mailbox | The domain's wizard is unfinished | Domains panel ← **Continue setup** — the wizard reopens at the saved stage |
| The verification code never arrives | The mail route is still closed | Wizard step 2: check Email Routing and Catch-all in the dashboard, then grab a fresh code |
| Outgoing mail fails | Key/sender | Settings ← Outgoing mail ← Test; the sender domain must be verified on the provider |
| A raw Worker error (`1101`) | Should not happen | Every error is converted into the guide page; if you ever see a raw one, the text inside the page is enough to report it — `npx wrangler tail` gives live logs |
| The page does not load at all | Dashboard/service issue | Check [cloudflarestatus.com](https://www.cloudflarestatus.com) |

## FAQ

<details>
<summary><b>How do I update Cmail?</b></summary>

Two paths. If you installed via **Route 2**, just paste the new `worker.js` into Edit Code and Deploy — the database structure is repaired by the D1 step on the setup screen (it only adds missing columns and indexes; it never touches your data). If you installed via **Route 1/3**: `git pull` and `npx wrangler deploy` (migrations apply with `npx wrangler d1 migrations apply cmail-db --remote`).
</details>

<details>
<summary><b>I left a domain half-registered — what happens to it?</b></summary>

Nothing is lost. It stays in the domains table wearing its Draft chip; **Continue setup** reopens the wizard at the exact stage. If you did not want the draft either, "Exit without saving" in the wizard removes it. Until it verifies, mailboxes stay locked on it.
</details>

<details>
<summary><b>Can I use several domains?</b></summary>

Yes — enable each domain on Cloudflare, add it under Domains, and walk its wizard through verification. Inboxes across all verified domains work instantly.
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

One Worker serves the UI, the API, the incoming-mail handler and the hourly cleanup cron. One D1 database holds everything. The UI itself is part of the Worker bundle, so deployments are atomic: paste one file, and interface and backend always match.

**The hourly cron — `17 * * * *`**

Every hour at minute 17, four quiet sweeps:

| What | Where | Rule |
|---|---|---|
| Expired temporary inboxes | their mail + the address itself | TTL passed → everything goes |
| Retention | old messages | only when a retention window is set in Settings |
| Sessions | expired tokens | stale sign-ins swept |
| Rate limits | old windows | hour-old counters emptied |

**Verification inside the mail path** — when the worker receives a message, it first asks the domain's state: if the domain is verifying and the recipient is exactly its one-of-a-kind code, the message is not stored — it *is* the confirmation, and the domain turns verified. All other mail to an unfinished domain is dropped silently, because no mailbox exists yet to catch it.

**Database map** — what each table owns:

| Table | Purpose |
|---|---|
| `users` | The admin account, PBKDF2 password hash, optional TOTP secret (sealed) |
| `sessions` | Login sessions (token, expiry, UA/IP for the session list) |
| `domains` | Connected domains + the registration state machine (draft, verifying, verified, skipped) and the loop-verification code |
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
- `GET /api/setup/tables` — the D1 inspector: expected tables with row counts, the missing, and the strays. Building one, building all, and dropping strays are all buttons, not commands.
- `POST /api/addresses/domains/:id/wizard` — the registration state machine: connect, fresh code, save draft, resume, skip-with-responsibility.
- `POST` to the Worker (Email Routing) — checks the verification code first, then parses MIME, stores mail, and auto-creates unknown catch-all inboxes as temporary ones.

## License

MIT © [Erfan-8910](https://github.com/Erfan-8910)

---

<div align="center">

**Cmail** — *your mailbox, your rules.* 🌿

*Build it. Own it. Never pay rent for an inbox again.* ✨

[فارسی](README.fa.md) · [Releases](https://github.com/Erfan-8910/Cmail/releases) · [License](LICENSE)

</div>
