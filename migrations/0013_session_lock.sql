-- ============================================================================
--  Cmail migration 0013 — the lock screen becomes a SERVER fact
-- ----------------------------------------------------------------------------
--  Before this release the padlock was client theater: a sessionStorage flag
--  and a DOM overlay. Deleting the overlay with the browser inspector — or
--  just clearing sessionStorage — "unlocked" a panel whose mail data was
--  already sitting in the DOM behind it. The server never knew the session
--  was locked, so it kept answering every API happily.
--
--  Now the locked state lives ON THE SESSION ROW. A locked session refuses
--  every data endpoint at the API itself (403 session_locked) — the overlay
--  is only the honest painting of a state the worker enforces. This column
--  carries that state: 0 = open, timestamp = locked (per session, the way a
--  phone locks per device — other signed-in browsers keep working).
--
--  CLI users:  npx wrangler d1 migrations apply cmail-db --remote
-- ============================================================================

ALTER TABLE sessions ADD COLUMN locked_at INTEGER NOT NULL DEFAULT 0;
