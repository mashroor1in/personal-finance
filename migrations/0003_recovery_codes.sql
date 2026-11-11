-- One-time password recovery codes.
--
-- Only a salted SHA-256 hash of each code is stored. The plaintext codes are
-- shown to the user exactly once, at generation time, and never again.
--
-- Codes are single-use: `used_at` is set when one is redeemed. Rotation deletes
-- the whole set for a user, so an old code can never survive a new set.
CREATE TABLE IF NOT EXISTS recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_recovery_codes_unused ON recovery_codes(user_id, used_at);
