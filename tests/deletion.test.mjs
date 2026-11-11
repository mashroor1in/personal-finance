import test from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as auth } from "../functions/api/auth/login.js";
import { onRequestGet as readLedger } from "../functions/api/data/index.js";
import {
  addDeletedMonth,
  addMonth,
  makeDB,
  makeKV,
} from "./helpers/auth-fakes.mjs";
import { DELETED_DATA_RETENTION_DAYS } from "../functions/_lib/retention.js";

const DAY_MS = 24 * 60 * 60 * 1000;

let ipSeq = 0;
function nextIP() {
  ipSeq += 1;
  return `203.0.113.${ipSeq}`;
}

async function post(body, env, path = "/api/auth/login", cookie = "") {
  return auth({
    request: new Request(`https://app.local${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": nextIP(),
        ...(cookie ? { cookie: `pf_session=${cookie}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    env,
  });
}

function tokenFrom(response) {
  const header = response.headers.get("set-cookie") || "";
  const match = header.match(/pf_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function register(env, username = "alice", password = "secret1") {
  const response = await post(
    { mode: "register", username, password, confirmPassword: password },
    env
  );
  return { response, body: await response.json(), token: tokenFrom(response) };
}

async function login(env, username, password) {
  return post({ mode: "login", username, password }, env);
}

async function deleteAccount(env, token, password = "secret1") {
  return post(
    { mode: "resetaccount", password, resetConfirm: "DELETE" },
    env,
    "/api/auth/login",
    token
  );
}

test("deleting an account archives its ledger for thirty days instead of erasing it", async () => {
  const db = makeDB(new Map());
  const env = { SESSIONS: makeKV(), DB: db };

  const { token } = await register(env, "dana", "secret1");
  addMonth(db, "dana", "2026-01", {
    salary: 5000,
    items: { rent: { amount: 1200 } },
    paid: { rent: true },
  });
  addMonth(db, "dana", "2026-02", { salary: 5100 });

  const before = Date.now();
  const response = await deleteAccount(env, token);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.retentionDays, DELETED_DATA_RETENTION_DAYS);

  // The account itself is gone at once.
  assert.equal(db.users.has("dana"), false);
  assert.equal(db.recoveryCodes.size, 0);
  assert.equal(db.months.size, 0);

  // The ledger is not.
  assert.equal(db.deletedMonths.size, 2);
  const archived = db.deletedMonths.get("dana|2026-01");
  assert.equal(archived.salary, 5000);
  assert.equal(JSON.parse(archived.items_json).rent.amount, 1200);
  assert.equal(JSON.parse(archived.paid_json).rent, true);
  assert.equal(archived.created_at, 1);

  const earliest = before + DELETED_DATA_RETENTION_DAYS * DAY_MS;
  const latest = Date.now() + DELETED_DATA_RETENTION_DAYS * DAY_MS;
  assert.ok(archived.purge_after >= earliest, "purge date is not early");
  assert.ok(archived.purge_after <= latest, "purge date is not late");
});

test("expired trash is erased on the next successful sign-in", async () => {
  const db = makeDB(new Map());
  const env = { SESSIONS: makeKV(), DB: db };
  await register(env, "evan", "secret1");

  const now = Date.now();
  addDeletedMonth(db, "old", "2025-01", now - 1000);
  addDeletedMonth(db, "old", "2025-02", now + DAY_MS);
  assert.equal(db.deletedMonths.size, 2);

  const response = await login(env, "evan", "secret1");
  assert.equal(response.status, 200);

  assert.equal(db.deletedMonths.has("old|2025-01"), false);
  assert.equal(db.deletedMonths.has("old|2025-02"), true);
});

test("re-registering the same username never resurrects trashed data", async () => {
  const db = makeDB(new Map());
  const env = { SESSIONS: makeKV(), DB: db };

  const { token } = await register(env, "fiona", "secret1");
  addMonth(db, "fiona", "2026-03", { salary: 9000 });
  await deleteAccount(env, token);
  assert.equal(db.deletedMonths.size, 1);

  const { token: freshToken } = await register(env, "fiona", "secret2");

  // The old rows exist in the recycle bin but are not part of the live ledger,
  // so the new holder of the name sees an empty planner.
  assert.equal(db.months.size, 0);
  assert.equal(db.deletedMonths.size, 1);

  const ledger = await readLedger({
    request: new Request("https://app.local/api/data", {
      headers: { cookie: `pf_session=${freshToken}` },
    }),
    env,
  });
  const body = await ledger.json();
  assert.deepEqual(body.data, {});
});

test("a ledger read only ever sees live rows, never trash", async () => {
  const db = makeDB(new Map());
  const env = { SESSIONS: makeKV(), DB: db };

  const { token } = await register(env, "gina", "secret1");
  addMonth(db, "gina", "2026-04", { salary: 100 });
  addDeletedMonth(db, "gina", "2026-05", Date.now() + DAY_MS, { salary: 999 });

  const ledger = await readLedger({
    request: new Request("https://app.local/api/data", {
      headers: { cookie: `pf_session=${token}` },
    }),
    env,
  });
  const body = await ledger.json();

  assert.deepEqual(Object.keys(body.data), ["2026-04"]);
  assert.equal(body.data["2026-04"].salary, 100);
});

test("deletion still completes when the recycle bin has not been migrated", async () => {
  const db = makeDB(new Map());
  const env = { SESSIONS: makeKV(), DB: db };

  const { token } = await register(env, "hugo", "secret1");
  addMonth(db, "hugo", "2026-06", { salary: 1 });

  const realBatch = db.batch;
  db.batch = async (statements) => {
    if (statements.some((statement) => /deleted_months/i.test(statement.sql))) {
      throw new Error("D1_ERROR: no such table: deleted_months: SQLITE_ERROR");
    }
    return realBatch(statements);
  };

  const response = await deleteAccount(env, token);

  // A missing archive must not trap the user inside an account the server
  // already refused to authenticate.
  assert.equal(response.status, 200);
  assert.equal(db.users.has("hugo"), false);
  assert.equal(db.months.size, 0);
});

test("a real archive failure is surfaced instead of destroying the data", async () => {
  const db = makeDB(new Map());
  const env = { SESSIONS: makeKV(), DB: db };

  const { token } = await register(env, "iris", "secret1");
  addMonth(db, "iris", "2026-07", { salary: 42 });

  db.batch = async () => {
    throw new Error("D1_ERROR: network connection lost");
  };

  await assert.rejects(() => deleteAccount(env, token), /network connection lost/);

  // Nothing was silently thrown away: the account and its month are intact.
  assert.equal(db.users.has("iris"), true);
  assert.equal(db.months.size, 1);
});

test("a second deletion inside the window keeps the newest copy", async () => {
  const db = makeDB(new Map());
  const env = { SESSIONS: makeKV(), DB: db };

  // Simulate an earlier deletion of the same username, still inside the window.
  const earlier = Date.now() - 5 * DAY_MS;
  addDeletedMonth(db, "jane", "2026-08", earlier + DELETED_DATA_RETENTION_DAYS * DAY_MS, {
    salary: 1,
  });

  const { token } = await register(env, "jane", "secret2");
  addMonth(db, "jane", "2026-08", { salary: 7777 });
  const before = Date.now();
  const response = await deleteAccount(env, token, "secret2");

  assert.equal(response.status, 200);
  const archived = db.deletedMonths.get("jane|2026-08");
  assert.equal(archived.salary, 7777);
  assert.ok(archived.purge_after >= before + DELETED_DATA_RETENTION_DAYS * DAY_MS);
});
