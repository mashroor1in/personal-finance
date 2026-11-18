-- Ledger durability.
--
-- 1. `months.version` makes writes conditional. A client sends the version it
--    last saw; the update only applies when the row still has that version, so
--    a stale tab gets a 409 instead of silently overwriting newer data.
--
-- 2. `user_settings` gives `__meta` (custom expenses, renames, hidden items,
--    category budgets) somewhere to live. It used to be localStorage-only, so
--    a second device silently lost all of it.
--
-- Run this once, before deploying code that expects the column:
--
--   wrangler d1 execute personal-expenses-db \
--     --file migrations/0005_ledger_durability.sql --remote

ALTER TABLE months ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
