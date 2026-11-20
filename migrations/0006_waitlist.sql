-- Early Access Waitlist
--
-- Creates the waitlist data model:
--   1. `waitlist`        one row per registration (unique, normalised email)
--   2. `waitlist_events` append-only audit log used for analytics
--   3. two read-only views for the common queries
--
-- Notes on the shape:
--   * `email` is normalised to lowercase by the API and enforced here with a
--     CHECK, so two rows can never differ only by case.
--   * Only a *hash* of the verification token is stored. The raw token never
--     touches the database.
--   * `referral_code` is unique so a shared link resolves to exactly one person.
--   * SQLite does not allow INDEX clauses inside CREATE TABLE, so every index
--     is created separately below.
--
-- Idempotent: safe to re-run. Every statement uses IF NOT EXISTS and there is
-- no ALTER TABLE.
--
-- Apply once, before deploying the waitlist functions:
--
--   wrangler d1 execute personal-expenses-db \
--     --file migrations/0006_waitlist.sql --remote

CREATE TABLE IF NOT EXISTS waitlist (
  id                     TEXT PRIMARY KEY,
  email                  TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  name                   TEXT,
  country                TEXT,
  referral_code          TEXT,
  referred_by            TEXT,
  signup_source          TEXT NOT NULL DEFAULT 'early-access',
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'verified', 'invited', 'expired')),
  email_verified         INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  verification_token_hash TEXT,
  created_at             INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at             INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  verified_at            INTEGER,
  invited_at             INTEGER
);

-- Lookup paths used by the API.
CREATE INDEX IF NOT EXISTS idx_waitlist_email        ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_status       ON waitlist(status);
CREATE INDEX IF NOT EXISTS idx_waitlist_created      ON waitlist(created_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_signup_source ON waitlist(signup_source);

-- Referral code is unique: one code, one owner. Partial so NULLs are allowed
-- for rows created before a code was assigned.
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_referral_code
  ON waitlist(referral_code) WHERE referral_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_waitlist_referred_by
  ON waitlist(referred_by) WHERE referred_by IS NOT NULL;

-- Verification lookup is always `WHERE email = ? AND verification_token_hash = ?`.
CREATE INDEX IF NOT EXISTS idx_waitlist_verification_token
  ON waitlist(verification_token_hash) WHERE verification_token_hash IS NOT NULL;

-- Append-only audit log. `event_type` is intentionally *not* constrained by a
-- CHECK here: adding a new analytics event should not require a migration.
-- The API keeps the vocabulary in one place and validates before insert.
CREATE TABLE IF NOT EXISTS waitlist_events (
  id          TEXT PRIMARY KEY,
  waitlist_id TEXT NOT NULL REFERENCES waitlist(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  event_data  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  ip_address  TEXT,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS idx_waitlist_events_waitlist_id ON waitlist_events(waitlist_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_events_type        ON waitlist_events(event_type);
CREATE INDEX IF NOT EXISTS idx_waitlist_events_created     ON waitlist_events(created_at);

-- Verified and invited people: the launch list.
CREATE VIEW IF NOT EXISTS active_waitlist AS
SELECT id, email, name, country, referral_code, referred_by, signup_source,
       created_at, invited_at
FROM waitlist
WHERE status IN ('verified', 'invited')
ORDER BY created_at;

-- Registered but not yet confirmed.
CREATE VIEW IF NOT EXISTS pending_verification AS
SELECT id, email, name, country, created_at
FROM waitlist
WHERE status = 'pending' AND email_verified = 0
ORDER BY created_at;

-- Referral leaderboard.
CREATE VIEW IF NOT EXISTS referral_counts AS
SELECT w.id, w.email, w.name, w.referral_code,
       COUNT(r.id) AS referrals,
       SUM(CASE WHEN r.status = 'verified' THEN 1 ELSE 0 END) AS verified_referrals
FROM waitlist w
LEFT JOIN waitlist r ON r.referred_by = w.id
WHERE w.referral_code IS NOT NULL
GROUP BY w.id, w.email, w.name, w.referral_code
ORDER BY referrals DESC;
