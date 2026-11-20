-- Waitlist verification-link freshness
--
-- `0006` measured the 24-hour verification window from `created_at`. That is
-- wrong the moment a link is re-issued: someone who signs up and clicks the
-- link two days later gets an "expired" page, presses "send a new link", and
-- receives a token that is *already* older than the window, because
-- `created_at` never moved. The new link could never work.
--
-- `verification_sent_at` records when the currently stored token was issued,
-- so re-issuing resets the window instead of inheriting the signup age.
--
-- Run once, after `0006_waitlist.sql`:
--
--   wrangler d1 execute personal-expenses-db \
--     --file migrations/0007_waitlist_verification_sent_at.sql --remote
--
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so re-running this fails with
-- "duplicate column name". That is intentional: a failure here means it has
-- already been applied.

ALTER TABLE waitlist ADD COLUMN verification_sent_at INTEGER;

-- Existing rows: the token they hold is as old as the signup.
UPDATE waitlist
   SET verification_sent_at = created_at
 WHERE verification_sent_at IS NULL;
