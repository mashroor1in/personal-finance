CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS months (
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  salary REAL DEFAULT 0,
  items_json TEXT NOT NULL DEFAULT '{}',
  paid_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_months_user ON months(user_id);
CREATE INDEX IF NOT EXISTS idx_months_updated ON months(updated_at);
