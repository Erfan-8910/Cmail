-- Cmail 0004 — performance indexes for the real query paths
-- (inbox lists, unread counts, session auth, cron cleanups)

CREATE INDEX IF NOT EXISTS idx_sessions_exp     ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_attempts_window  ON auth_attempts(window_start);
CREATE INDEX IF NOT EXISTS idx_addresses_domain ON addresses(domain_id);
CREATE INDEX IF NOT EXISTS idx_addresses_exp    ON addresses(kind, expires_at);
CREATE INDEX IF NOT EXISTS idx_emails_unread    ON emails(address_id, is_read);
