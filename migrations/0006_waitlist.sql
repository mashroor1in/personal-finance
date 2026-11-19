-- Early Access Waitlist
--
-- 1. Creates a dedicated table for waitlist registrations with comprehensive fields
--    for tracking user signups, referrals, and verification status.
--
-- 2. Implements proper indexing for performance and query optimization.
--
-- 3. Includes security features like verification tokens and status tracking.
--
-- Run this once before deploying the waitlist functionality:
--
--   wrangler d1 execute personal-expenses-db \
--     --file migrations/0006_waitlist.sql --remote

-- Create waitlist table with comprehensive fields
CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  country TEXT,
  referral_code TEXT,
  referred_by TEXT,
  signup_source TEXT NOT NULL DEFAULT 'early-access',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'invited', 'expired')),
  email_verified BOOLEAN NOT NULL DEFAULT 0,
  verification_token_hash TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  verified_at INTEGER,
  invited_at INTEGER,
  
  -- Indexes for performance optimization
  INDEX idx_waitlist_email (email),
  INDEX idx_waitlist_status (status),
  INDEX idx_waitlist_created (created_at),
  INDEX idx_waitlist_referral (referral_code),
  INDEX idx_waitlist_referred_by (referred_by),
  INDEX idx_waitlist_signup_source (signup_source)
);

-- Create referral index for faster lookups
CREATE INDEX IF NOT EXISTS idx_waitlist_referral_lookup ON waitlist(referral_code) WHERE referral_code IS NOT NULL;

-- Create referred by index for tracking referrals
CREATE INDEX IF NOT EXISTS idx_waitlist_referred_by_lookup ON waitlist(referred_by) WHERE referred_by IS NOT NULL;

-- Create verification token index for token verification
CREATE INDEX IF NOT EXISTS idx_waitlist_verification_token ON waitlist(verification_token_hash) WHERE verification_token_hash IS NOT NULL;

-- Create a table for tracking waitlist analytics and events
CREATE TABLE IF NOT EXISTS waitlist_events (
  id TEXT PRIMARY KEY,
  waitlist_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('signup', 'verification', 'invitation', 'referral', 'email_sent', 'error')),
  event_data TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  ip_address TEXT,
  user_agent TEXT,
  
  -- Foreign key constraint
  FOREIGN KEY (waitlist_id) REFERENCES waitlist(id) ON DELETE CASCADE,
  
  -- Indexes for analytics
  INDEX idx_waitlist_events_waitlist_id (waitlist_id),
  INDEX idx_waitlist_events_type (event_type),
  INDEX idx_waitlist_events_created (created_at)
);

-- Create analytics index for event type queries
CREATE INDEX IF NOT EXISTS idx_waitlist_events_type_lookup ON waitlist_events(event_type) WHERE event_type IS NOT NULL;

-- Create trigger for updating timestamps
CREATE TRIGGER IF NOT EXISTS update_waitlist_timestamps
  AFTER UPDATE ON waitlist
  FOR EACH ROW
BEGIN
  UPDATE waitlist SET updated_at = (unixepoch() * 1000) WHERE id = NEW.id;
END;

-- Create view for active waitlist entries (verified and invited)
CREATE VIEW IF NOT EXISTS active_waitlist AS
SELECT id, email, name, country, referral_code, referred_by, signup_source, created_at, invited_at
FROM waitlist
WHERE status IN ('verified', 'invited')
ORDER BY created_at;

-- Create view for pending verification entries
CREATE VIEW IF NOT EXISTS pending_verification AS
SELECT id, email, name, country, created_at
FROM waitlist
WHERE status = 'pending' AND email_verified = 0
ORDER BY created_at;