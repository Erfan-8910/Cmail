-- ============================================================================
--  Cmail migration 0002 — mailbox identity
-- ----------------------------------------------------------------------------
--  Every inbox becomes a full account space of its own:
--    1) addresses.notes          — per-mailbox memo (owner, purpose, hints)
--    2) totp_entries.address_id  — a 2FA key can be bound to one inbox, so
--                                  its codes show only inside that account
--    3) totp_entries.icon        — a mark from the built-in glyph library
--
--  SQLite has no ADD COLUMN IF NOT EXISTS, so these ALTERs run exactly once
--  through the migration tracker. Fresh installs already get the final
--  shape from schema.sql / the one-click button (which treats failures
--  here as harmless "already there" signals).
-- ============================================================================

ALTER TABLE addresses ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE totp_entries ADD COLUMN address_id TEXT REFERENCES addresses(id) ON DELETE SET NULL;
ALTER TABLE totp_entries ADD COLUMN icon TEXT;

CREATE INDEX IF NOT EXISTS idx_totp_addr ON totp_entries(address_id);
