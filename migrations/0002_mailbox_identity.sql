-- Cmail 0002 — mailbox identity: every inbox becomes a full account space
-- 1) per-mailbox notes (usage notes kept beside the mailbox)
ALTER TABLE addresses ADD COLUMN notes TEXT NOT NULL DEFAULT '';
-- 2) TOTP entries can belong to one mailbox (2FA stored on that account only)
ALTER TABLE totp_entries ADD COLUMN address_id TEXT REFERENCES addresses(id) ON DELETE SET NULL;
-- 3) TOTP entries get a glyph logo from the built-in mark library
ALTER TABLE totp_entries ADD COLUMN icon TEXT;

CREATE INDEX IF NOT EXISTS idx_totp_addr ON totp_entries(address_id);
