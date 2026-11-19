-- Bucksy Early Access Waitlist Database Schema
-- 
-- This file documents the complete database schema for the waitlist functionality.
-- For the actual migration, see migrations/0006_waitlist.sql

-- Main waitlist table
CREATE TABLE waitlist (
  id TEXT PRIMARY KEY,                    -- UUID for each registration
  email TEXT NOT NULL UNIQUE,             -- Normalized email address
  name TEXT,                              -- User's name (optional)
  country TEXT,                           -- User's country (optional)
  referral_code TEXT,                     -- Unique referral code
  referred_by TEXT,                       -- ID of user who referred this user
  signup_source TEXT NOT NULL DEFAULT 'early-access', -- Source of signup
  status TEXT NOT NULL DEFAULT 'pending',  -- Status: pending, verified, invited, expired
  email_verified BOOLEAN NOT NULL DEFAULT 0, -- Whether email is verified
  verification_token_hash TEXT,           -- Hash of verification token
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000), -- Registration timestamp
  verified_at INTEGER,                    -- Email verification timestamp
  invited_at INTEGER                      -- Invitation timestamp
);

-- Waitlist events table for analytics
CREATE TABLE waitlist_events (
  id TEXT PRIMARY KEY,                    -- UUID for each event
  waitlist_id TEXT NOT NULL,              -- Reference to waitlist entry
  event_type TEXT NOT NULL,               -- Type of event
  event_data TEXT,                       -- Additional event data as JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000), -- Event timestamp
  ip_address TEXT,                        -- IP address when event occurred
  user_agent TEXT                         -- User agent when event occurred
);

-- Database Views
CREATE VIEW active_waitlist AS
SELECT id, email, name, country, referral_code, referred_by, signup_source, created_at, invited_at
FROM waitlist
WHERE status IN ('verified', 'invited')
ORDER BY created_at;

CREATE VIEW pending_verification AS
SELECT id, email, name, country, created_at
FROM waitlist
WHERE status = 'pending' AND email_verified = 0
ORDER BY created_at;

-- Indexes for performance
CREATE INDEX idx_waitlist_email ON waitlist(email);
CREATE INDEX idx_waitlist_status ON waitlist(status);
CREATE INDEX idx_waitlist_created ON waitlist(created_at);
CREATE INDEX idx_waitlist_referral ON waitlist(referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX idx_waitlist_referred_by ON waitlist(referred_by) WHERE referred_by IS NOT NULL;
CREATE INDEX idx_waitlist_signup_source ON waitlist(signup_source);
CREATE INDEX idx_waitlist_events_waitlist_id ON waitlist_events(waitlist_id);
CREATE INDEX idx_waitlist_events_type ON waitlist_events(event_type);
CREATE INDEX idx_waitlist_events_created ON waitlist_events(created_at);

-- Triggers
CREATE TRIGGER update_waitlist_timestamps
AFTER UPDATE ON waitlist
FOR EACH ROW
BEGIN
  UPDATE waitlist SET updated_at = (unixepoch() * 1000) WHERE id = NEW.id;
END;

-- Data Constraints
-- Status values: pending, verified, invited, expired
-- Event types: signup, verification, invitation, referral, email_sent, error