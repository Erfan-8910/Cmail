-- ============================================================================
--  Cmail migration 0003 — vault folders
-- ----------------------------------------------------------------------------
--  Group 2FA keys into user-managed folders: create, rename, delete.
--  Deleting a folder releases its keys (folder_id becomes NULL) —
--  no key is ever lost with the folder.
-- ============================================================================

CREATE TABLE IF NOT EXISTS totp_folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  created_at INTEGER NOT NULL
);
ALTER TABLE totp_entries ADD COLUMN folder_id TEXT REFERENCES totp_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_totp_folder ON totp_entries(folder_id);
CREATE INDEX IF NOT EXISTS idx_folders_user ON totp_folders(user_id);
