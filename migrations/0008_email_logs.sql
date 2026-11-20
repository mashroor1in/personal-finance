-- Email Delivery Logging
--
-- Tracks all email delivery attempts for analytics, debugging, and compliance.
--
-- This table captures:
-- - When and to whom emails were sent
-- - The type of email (welcome, verification, etc.)
-- - Delivery status and provider response
-- - Error details for failed deliveries
--
-- Run once:
--
--   wrangler d1 execute personal-expenses-db \
--     --file migrations/0008_email_logs.sql --remote
--
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so re-running this fails with
-- "duplicate column name". That is intentional: a failure here means it has
-- already been applied.
--

CREATE TABLE IF NOT EXISTS email_logs (
  id                    TEXT PRIMARY KEY,
  to_address            TEXT NOT NULL,
  subject               TEXT NOT NULL,
  email_type            TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('sending', 'delivered', 'failed', 'bounced')),
  provider_id           TEXT,                         -- Message ID from provider (Resend ID, SendGrid X-Message-Id, etc.)
  error_message         TEXT,                         -- NULL for successful deliveries
  created_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Index for looking up all emails sent to a specific address
CREATE INDEX IF NOT EXISTS idx_email_logs_to_address ON email_logs(to_address);

-- Index for filtering by email type (e.g., all verification emails)
CREATE INDEX IF NOT EXISTS idx_email_logs_type ON email_logs(email_type);

-- Index for filtering by status (e.g., all failed deliveries)
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);

-- Index for chronological ordering
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at);

-- Index for looking up provider message IDs (useful for debugging with providers)
CREATE INDEX IF NOT EXISTS idx_email_logs_provider_id ON email_logs(provider_id);

-- View for analytics: email delivery statistics by type
CREATE VIEW IF NOT EXISTS email_stats AS
SELECT
  email_type,
  COUNT(*) as total_sent,
  SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
  SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as bounced,
  AVG(CASE WHEN status = 'delivered' THEN created_at END - 
      MIN(CASE WHEN status = 'sending' THEN created_at END) OVER (PARTITION BY email_type)) as avg_delivery_time_ms
FROM email_logs
GROUP BY email_type;

-- View for recent failures (useful for monitoring)
CREATE VIEW IF NOT EXISTS recent_failures AS
SELECT
  id,
  to_address,
  subject,
  email_type,
  error_message,
  created_at
FROM email_logs
WHERE status IN ('failed', 'bounced')
ORDER BY created_at DESC
LIMIT 100;