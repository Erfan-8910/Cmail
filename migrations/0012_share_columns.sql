-- ============================================================================
--  Cmail migration 0012 — the two share columns the chain never added
-- ----------------------------------------------------------------------------
--  Migration 0010 introduced max_devices + guest_note but deferred their
--  ALTERs to "the deploy script" — and the deploy script never ran them.
--  Migration 0011 added the other four share columns and skipped them too.
--  The result: every database built through THIS migration chain (deploy.sh,
--  npm run setup, wrangler d1 migrations apply) ended with a share_links
--  table missing two columns that the 3.0.0 code SELECTs unconditionally —
--  worst of all inside getUserFromToken, which answers EVERY authenticated
--  request. On such installs the panel bounced straight back to the login
--  form right after a successful sign-in: the "cannot login (wrong username
--  or password)" report of issue #2 — the password was never wrong, the
--  schema was.
--
--  Fresh chains get the columns here; installs already migrated to 0011 get
--  them by applying this migration. Databases built from schema.sql (the
--  setup gate / one-click button) already carry both columns and never run
--  this chain — and the same two ALTERs also ride along as optional "heal"
--  statements inside the worker, so the Health panel's Repair button fixes
--  any older install with one press.
--
--  CLI users:  npx wrangler d1 migrations apply cmail-db --remote
-- ============================================================================

ALTER TABLE share_links ADD COLUMN max_devices INTEGER NOT NULL DEFAULT 0;
ALTER TABLE share_links ADD COLUMN guest_note TEXT;
