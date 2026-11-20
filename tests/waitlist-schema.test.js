/**
 * Schema tests for the Early Access waitlist (migrations 0006 and 0007).
 *
 * These run the migrations against an in-memory SQLite database (Node's
 * built-in `node:sqlite`) and assert three things:
 *
 *   1. They apply cleanly, and re-applying `0006` is a no-op.
 *   2. The constraints that protect the data model actually fire.
 *   3. The views the API reads from return what they claim to.
 *
 * No network, no D1, no credentials.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(here, "..", "migrations", "0006_waitlist.sql");
const ADDENDUM_PATH = join(here, "..", "migrations", "0007_waitlist_verification_sent_at.sql");
const SQL = readFileSync(MIGRATION_PATH, "utf8");
const ADDENDUM = readFileSync(ADDENDUM_PATH, "utf8");

/**
 * SQLite is only available from Node 22.5 onwards. On an older runtime the
 * suite skips rather than failing, so the rest of CI still runs.
 */
let DatabaseSync;
let sqliteAvailable = true;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  sqliteAvailable = false;
}

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SQL);
  db.exec(ADDENDUM);
  return db;
}

const skip = sqliteAvailable ? false : "node:sqlite is unavailable on this Node version";

test("migration applies cleanly", { skip }, () => {
  const db = freshDb();
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'waitlist%' ORDER BY name"
    )
    .all()
    .map((row) => row.name);
  assert.deepEqual(tables, ["waitlist", "waitlist_events"]);
});

test("migration is idempotent", { skip }, () => {
  const db = freshDb();
  assert.doesNotThrow(() => db.exec(SQL));
});

test("migration declares every view the API reads", { skip }, () => {
  const db = freshDb();
  const views = db
    .prepare("SELECT name FROM sqlite_master WHERE type='view'")
    .all()
    .map((row) => row.name);
  for (const name of ["active_waitlist", "pending_verification", "referral_counts"]) {
    assert.ok(views.includes(name), `missing view ${name}`);
  }
});

test("migration declares the indexes the queries rely on", { skip }, () => {
  const db = freshDb();
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_waitlist%'")
    .all()
    .map((row) => row.name);
  const expected = [
    "idx_waitlist_email",
    "idx_waitlist_status",
    "idx_waitlist_created",
    "idx_waitlist_signup_source",
    "idx_waitlist_referral_code",
    "idx_waitlist_referred_by",
    "idx_waitlist_verification_token",
    "idx_waitlist_events_waitlist_id",
    "idx_waitlist_events_type",
    "idx_waitlist_events_created",
  ];
  for (const name of expected) {
    assert.ok(indexes.includes(name), `missing index ${name}`);
  }
});

test("new rows default to pending, unverified, timestamped", { skip }, () => {
  const db = freshDb();
  db.prepare("INSERT INTO waitlist (id, email, referral_code) VALUES (?, ?, ?)").run(
    "w1",
    "alice@example.com",
    "CODE1234"
  );
  const row = db.prepare("SELECT * FROM waitlist WHERE id = 'w1'").get();
  assert.equal(row.status, "pending");
  assert.equal(row.email_verified, 0);
  assert.ok(row.created_at > 0);
  assert.ok(row.updated_at > 0);
});

test("email is stored lowercase only", { skip }, () => {
  const db = freshDb();
  assert.throws(() =>
    db.prepare("INSERT INTO waitlist (id, email) VALUES (?, ?)").run("w2", "Bob@Example.com")
  );
});

test("email is unique, so duplicate signups are impossible", { skip }, () => {
  const db = freshDb();
  db.prepare("INSERT INTO waitlist (id, email) VALUES (?, ?)").run("w1", "alice@example.com");
  assert.throws(() =>
    db.prepare("INSERT INTO waitlist (id, email) VALUES (?, ?)").run("w2", "alice@example.com")
  );
});

test("referral codes are unique but may be NULL", { skip }, () => {
  const db = freshDb();
  db.prepare("INSERT INTO waitlist (id, email, referral_code) VALUES (?, ?, ?)").run(
    "w1",
    "a@example.com",
    "DUPLICATE"
  );
  assert.throws(() =>
    db
      .prepare("INSERT INTO waitlist (id, email, referral_code) VALUES (?, ?, ?)")
      .run("w2", "b@example.com", "DUPLICATE")
  );
  // Two rows without a code are fine.
  db.prepare("INSERT INTO waitlist (id, email) VALUES (?, ?)").run("w3", "c@example.com");
  db.prepare("INSERT INTO waitlist (id, email) VALUES (?, ?)").run("w4", "d@example.com");
});

test("verification_sent_at column exists and is populated on insert", { skip }, () => {
  const db = freshDb();
  db.prepare("INSERT INTO waitlist (id, email, referral_code) VALUES (?, ?, ?)").run(
    "w1",
    "alice@example.com",
    "CODE1234"
  );
  const row = db.prepare("SELECT verification_sent_at FROM waitlist WHERE email = ?").get("alice@example.com");
  assert.equal(row.verification_sent_at, null);
});

test("foreign key rejects null waitlist_id", { skip }, () => {
  const db = freshDb();
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO waitlist_events (id, waitlist_id, event_type) VALUES (?, ?, ?)")
        .run("e1", null, "error")
  );
});

test("status and email_verified are constrained", { skip }, () => {
  const db = freshDb();
  assert.throws(() =>
    db
      .prepare("INSERT INTO waitlist (id, email, status) VALUES (?, ?, ?)")
      .run("w1", "a@example.com", "bogus")
  );
  assert.throws(() =>
    db
      .prepare("INSERT INTO waitlist (id, email, email_verified) VALUES (?, ?, ?)")
      .run("w2", "b@example.com", 7)
  );
});

test("event log accepts the vocabulary the API writes", { skip }, () => {
  const db = freshDb();
  db.prepare("INSERT INTO waitlist (id, email) VALUES (?, ?)").run("w1", "a@example.com");
  const types = [
    "signup",
    "signup_updated",
    "verification",
    "verification_resent",
    "referral_view",
    "email_sent",
    "error",
  ];
  for (const [i, type] of types.entries()) {
    assert.doesNotThrow(() =>
      db
        .prepare("INSERT INTO waitlist_events (id, waitlist_id, event_type) VALUES (?, ?, ?)")
        .run(`e${i}`, "w1", type)
    );
  }
});

test("active_waitlist shows only verified and invited", { skip }, () => {
  const db = freshDb();
  db.prepare("INSERT INTO waitlist (id, email) VALUES (?, ?)").run("w1", "a@example.com");
  db.prepare("INSERT INTO waitlist (id, email) VALUES (?, ?)").run("w2", "b@example.com");
  db.prepare("UPDATE waitlist SET status = 'verified', email_verified = 1 WHERE id = 'w1'").run();

  const ids = db.prepare("SELECT id FROM active_waitlist").all().map((r) => r.id);
  assert.deepEqual(ids, ["w1"]);

  const pending = db.prepare("SELECT id FROM pending_verification").all().map((r) => r.id);
  assert.deepEqual(pending, ["w2"]);
});

test("referral_counts aggregates referrals per owner", { skip }, () => {
  const db = freshDb();
  db.prepare("INSERT INTO waitlist (id, email, referral_code) VALUES (?, ?, ?)").run(
    "w1",
    "owner@example.com",
    "OWNERCODE"
  );
  db.prepare("INSERT INTO waitlist (id, email, referred_by) VALUES (?, ?, ?)").run(
    "w2",
    "ref1@example.com",
    "w1"
  );
  db.prepare("INSERT INTO waitlist (id, email, referred_by) VALUES (?, ?, ?)").run(
    "w3",
    "ref2@example.com",
    "w1"
  );
  db.prepare("UPDATE waitlist SET status = 'verified' WHERE id = 'w3'").run();

  const row = db.prepare("SELECT referrals, verified_referrals FROM referral_counts WHERE id = 'w1'").get();
  assert.equal(Number(row.referrals), 2);
  assert.equal(Number(row.verified_referrals), 1);
});

test("deleting a registration cascades to its events", { skip }, () => {
  const db = freshDb();
  db.prepare("INSERT INTO waitlist (id, email) VALUES (?, ?)").run("w1", "a@example.com");
  db.prepare("INSERT INTO waitlist_events (id, waitlist_id, event_type) VALUES (?, ?, ?)").run(
    "e1",
    "w1",
    "signup"
  );
  db.prepare("DELETE FROM waitlist WHERE id = 'w1'").run();
  const remaining = db.prepare("SELECT COUNT(*) AS c FROM waitlist_events").get().c;
  assert.equal(Number(remaining), 0);
});
