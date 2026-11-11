-- A 30-day recycle bin for a deleted account's planner data.
--
-- Deleting an account removes the credential immediately, so nobody can sign
-- in. The financial history moves here instead of being destroyed, which gives
-- the owner a month to notice a mistake and ask for a restore.
--
-- The table deliberately mirrors `months` column for column, so restoring is a
-- single INSERT ... SELECT. Reads never touch it: the live ledger queries only
-- `months`, so another person who later registers the same username cannot
-- inherit this data.
CREATE TABLE IF NOT EXISTS deleted_months (
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  salary REAL DEFAULT 0,
  items_json TEXT NOT NULL DEFAULT '{}',
  paid_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  deleted_at INTEGER NOT NULL,
  purge_after INTEGER NOT NULL,
  PRIMARY KEY (user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_deleted_months_purge ON deleted_months(purge_after);
CREATE INDEX IF NOT EXISTS idx_deleted_months_user ON deleted_months(user_id);
