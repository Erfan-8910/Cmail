#!/usr/bin/env bash
# ============================================================
#  Cmail — one-command Cloudflare installer
#  Creates the D1 database, applies migrations, sets secrets,
#  deploys the worker and (optionally) wires Email Routing.
# ============================================================
set -euo pipefail

BRAND='\033[1;36m'
OK='\033[1;32m'
ERR='\033[1;31m'
DIM='\033[2m'
R='\033[0m'

say()  { echo -e "${BRAND}▶${R} $1"; }
good() { echo -e "${OK}✔${R} $1"; }
fail() { echo -e "${ERR}✖ $1${R}"; exit 1; }

echo -e "${BRAND}"
cat <<'BANNER'
   ██████╗███╗   ███╗ █████╗ ██╗██╗
  ██╔════╝████╗ ████║██╔══██╗██║██║
  ██║     ██╔████╔██║███████║██║██║
  ██║     ██║╚██╔╝██║██╔══██║██║██║
  ╚██████╗██║ ╚═╝ ██║██║  ██║██║██║
   ╚═════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝╚═╝
     Liquid-glass mail on Cloudflare
BANNER
echo -e "${R}"

# ---------- checks ----------
command -v node >/dev/null || fail "Node.js 18+ is required — install it from https://nodejs.org"
command -v npm  >/dev/null || fail "npm is required"
node -e 'process.exit(process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || fail "Node.js 18+ required (found $(node -v))"

say "Installing dependencies…"
npm install --no-audit --no-fund >/dev/null 2>&1
good "dependencies ready"

# ---------- cloudflare auth ----------
say "Checking Cloudflare authentication…"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  good "using CLOUDFLARE_API_TOKEN from environment"
else
  if ! npx wrangler whoami 2>/dev/null | grep -q "logged in\|You are logged in"; then
    echo -e "${DIM}A browser window will open for Cloudflare login…${R}"
    npx wrangler login || fail "Cloudflare login failed"
  fi
  npx wrangler whoami | sed 's/^/  /'
  good "authenticated with Cloudflare"
fi

# ---------- instance identity (multi-install safe) ----------
# Every install owns its own Worker AND its own D1 database — nothing is
# shared between instances, so their data can never mix. The names can also
# be injected for scripted installs: CMAIL_WORKER_NAME / CMAIL_DB_NAME.
WORKER_NAME="${CMAIL_WORKER_NAME:-}"
DB_NAME="${CMAIL_DB_NAME:-}"

if [ -z "$WORKER_NAME" ]; then
  if [ -t 0 ]; then
    echo -e "${DIM}Second (or third…) install on this account? Give it a distinct name —${R}"
    echo -e "${DIM}the Worker and the database are both named after the instance, so no two${R}"
    echo -e "${DIM}installs can ever touch each other's data.${R}"
    read -r -p "Instance name [cmail]: " ANSWER || ANSWER=""
    WORKER_NAME="${ANSWER:-cmail}"
  else
    WORKER_NAME="cmail"
  fi
fi
echo "$WORKER_NAME" | grep -qE '^[a-z][a-z0-9-]{0,57}$' \
  || fail "Instance name must be lowercase letters/digits/dashes starting with a letter (max 58) — got “$WORKER_NAME”"

if [ -z "$DB_NAME" ]; then
  if [ "$WORKER_NAME" = "cmail" ]; then
    DB_NAME="cmail-db"
  elif [ -t 0 ]; then
    read -r -p "Database name [$WORKER_NAME-db]: " ANSWER || ANSWER=""
    DB_NAME="${ANSWER:-$WORKER_NAME-db}"
  else
    DB_NAME="$WORKER_NAME-db"
  fi
fi
echo "$DB_NAME" | grep -qE '^[a-zA-Z][a-zA-Z0-9_-]{0,62}$' \
  || fail "Database name must be letters/digits/underscore/dash (max 63) — got “$DB_NAME”"

say "This install deploys as:"
echo -e "  ${BRAND}Worker${R}    $WORKER_NAME  →  https://$WORKER_NAME.<your-subdomain>.workers.dev"
echo -e "  ${BRAND}Database${R} $DB_NAME  (owned by this instance alone)"

# write the instance identity into the working-copy config (never committed):
# Worker name, database name — and the database id is reset to the placeholder
# so the resolver below always binds the database that BELONGS to this name
# (a stale id from a previous run on this folder must never survive a switch).
node - "$WORKER_NAME" "$DB_NAME" <<'NODE'
const fs = require('fs');
const f = 'wrangler.jsonc';
let s = fs.readFileSync(f, 'utf8');
// `node -` keeps a "-" placeholder in argv[1] — real args start at argv[2]
const [, , worker, db] = process.argv;
// the Worker name — the top-level "name" key only (bindings use "binding")
s = s.replace(/(^|\n)(\s*)"name"\s*:\s*"[^"]*"/, `$1$2"name": "${worker}"`);
// the database name — every D1 binding in this config follows the instance
s = s.replace(/"database_name"\s*:\s*"[^"]*"/g, `"database_name": "${db}"`);
// reset the id so the resolver re-resolves for THIS name, not a stale one
if (/"database_id"\s*:\s*"[^"]*"/.test(s)) {
  s = s.replace(/"database_id"\s*:\s*"[^"]*"/, '"database_id": "REPLACE_WITH_D1_ID"');
} else {
  s = s.replace(/("database_name"\s*:\s*"[^"]*"\s*),?/, `$1\n      "database_id": "REPLACE_WITH_D1_ID",`);
}
fs.writeFileSync(f, s);
NODE
good "wrangler.jsonc → worker “$WORKER_NAME”, database “$DB_NAME”"

# ---------- d1 ----------
# find-or-create is deploy-resolve.mjs's job — the very same code the Deploy
# button's CI runs: resolves every D1 binding by database_name, creates the
# database when it truly does not exist, patches the working copy. No deploy
# happens here yet (CMAIL_RESOLVE_ONLY) — migrations run first below.
say "Creating (or finding) the D1 database “${DB_NAME}”…"
CMAIL_RESOLVE_ONLY=1 CMAIL_DB_NAME="$DB_NAME" node scripts/deploy-resolve.mjs || fail "Could not resolve the D1 database"
DB_ID=$(grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' wrangler.jsonc | head -1)
[ -n "$DB_ID" ] || fail "database_id missing after resolve"
good "D1 database: $DB_ID"

# ---------- migrations + secret ----------
say "Applying database migrations…"
npx wrangler d1 migrations apply "$DB_NAME" --remote
good "schema applied"
echo -e "${DIM}  (CLI users just got every table; dashboard users get a one-click\n   “Create tables automatically” button in the setup wizard instead.)${R}"

say "Setting APP_SECRET…"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
  echo "$SECRET" | npx wrangler secret put APP_SECRET >/dev/null 2>&1 || true
else
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
  echo "$SECRET" | npx wrangler secret put APP_SECRET || true
fi
good "APP_SECRET configured"

# ---------- deploy ----------
# the final deploy goes through deploy-resolve.mjs too — same code the button's
# CI runs: re-checks the binding, and keeps the build green when the account's
# cron-trigger slots are full (free plan: 5 per account).
say "Deploying Cmail…"
DEPLOY_RC=0
DEPLOY_OUT=$(CMAIL_DB_NAME="$DB_NAME" node scripts/deploy-resolve.mjs 2>&1) || DEPLOY_RC=$?
echo "$DEPLOY_OUT" | sed 's/^/  /'
[ "$DEPLOY_RC" -eq 0 ] || fail "deploy failed — see the output above"
WORKER_URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1 || true)
[ -n "$WORKER_URL" ] || WORKER_URL="(check wrangler output above)"
good "deployed: $WORKER_URL"

# ---------- optional: auto Email Routing ----------
echo ""
say "Email Routing automation (optional)"
echo -e "${DIM}To receive mail, the domain must use Cloudflare DNS and Email Routing must be enabled.${R}"
read -r -p "Automatically configure Email Routing now? Needs CLOUDFLARE_API_TOKEN with zone/email perms [y/N]: " ANSWER || ANSWER="n"
if [[ "${ANSWER:-n}" =~ ^[Yy]$ ]]; then
  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    read -r -p "CLOUDFLARE_API_TOKEN: " TOKEN
    export CLOUDFLARE_API_TOKEN="$TOKEN"
  fi
  read -r -p "Domain to configure (e.g. mail.example.com): " DOMAIN
  bash scripts/configure-email-routing.sh "$DOMAIN" "$WORKER_NAME" && good "Email Routing configured for $DOMAIN" \
    || echo -e "${ERR}automatic routing failed — follow the manual steps below${R}"
fi

echo ""
echo -e "${OK}──────────────────────────────────────────────────────${R}"
echo -e "  ${OK}Cmail is live at:${R} $WORKER_URL"
echo ""
echo -e "  ${BRAND}Next steps${R}"
echo -e "  1. Open the URL above — the setup wizard will guide you:"
echo -e "     database tables (one click) → admin account → domain → outgoing mail"
echo -e "  2. The wizard never touches a SQL console — the Init button creates"
echo -e "     every table and index automatically, and is safe to re-run."
echo ""
echo -e "  ${BRAND}Manual Email Routing (if skipped above)${R}"
echo -e "  • Cloudflare Dashboard → your domain → Email Routing"
echo -e "  • Enable Email Routing (MX + SPF records are added for you)"
echo -e "  • Routing → Catch-all address → Action: Send to Worker → ${BRAND}cmail${R}"
echo ""
echo -e "  ${BRAND}Useful commands${R}"
echo -e "  • live logs : ${DIM}npx wrangler tail${R}"
echo -e "  • redeploy  : ${DIM}npm run deploy${R}"
echo -e "${OK}──────────────────────────────────────────────────────${R}"
