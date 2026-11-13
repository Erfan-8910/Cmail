-- ============================================================================
--  Cmail migration 0010 — sharing 2.0: one credential, many mailboxes
-- ----------------------------------------------------------------------------
--  v3.0.0 turns the share system back into what it was meant to be: a guest
--  credential that can hold SEVERAL mailboxes at once, plus the settings the
--  first release had. share_addresses is the junction: one row per (share,
--  address) pair. share_links.address_id stays as the PRIMARY mailbox (the
--  one older code paths read) — the junction is the source of truth for the
--  full set.
--
--  Two new columns ride on share_links: max_devices and guest_note. SQLite
--  has no idempotent ALTER, so they were originally deferred to "the deploy
--  script" — which never ran them, leaving every migrations-built database
--  without them (the root cause of issue #2). They now have their own
--  migration: 0012_share_columns.sql. Do not rely on deploy scripts for
--  schema changes; the chain (or the worker's heal list) owns the shape.
--
--  CLI users:  npx wrangler d1 migrations apply cmail-db --remote
-- ============================================================================

CREATE TABLE IF NOT EXISTS share_addresses (
  share_id   TEXT NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  address_id TEXT NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
  PRIMARY KEY (share_id, address_id)
);

CREATE INDEX IF NOT EXISTS idx_share_addr_addr ON share_addresses(address_id);
