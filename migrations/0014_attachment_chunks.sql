-- ============================================================================
--  Cmail migration 0014 — attachments outgrow the single row
-- ----------------------------------------------------------------------------
--  Two real-world failures drove this migration:
--
--  1. Big attachments were second-class citizens. The payload lived in ONE
--     row (content_b64, ≤ ~650 KB raw); anything bigger was stored as a
--     NULL body with an honest "too big" chip that could never be opened or
--     downloaded. The paperclip on the list row still showed (the flag rode
--     on the raw mail size), so a letter LOOKED attached and then refused
--     to hand the file over.
--  2. Inline images never showed. Letters composed by the big clients embed
--     their pictures as MIME parts referenced by cid: — those parts were
--     listed as attachments but the letter body kept broken image boxes.
--
--  The fix: chunked storage. A payload bigger than the inline budget is
--  split into ordered chunk rows (each well under every platform limit),
--  and reassembled on read. content_id records the MIME Content-ID so the
--  reader can rewrite cid: references into real URLs. Both columns ride on
--  the attachments table itself; chunks live in their own table.
--
--  CLI users:  npx wrangler d1 migrations apply cmail-db --remote
-- ============================================================================

ALTER TABLE attachments ADD COLUMN chunks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attachments ADD COLUMN content_id TEXT;

CREATE TABLE IF NOT EXISTS attachment_chunks (
  att_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  idx    INTEGER NOT NULL,
  data   TEXT NOT NULL,                                  -- one ordered base64 slice of the payload
  PRIMARY KEY (att_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_attchunks_att ON attachment_chunks(att_id);
