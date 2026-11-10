import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeLedgerPayload } from "../functions/_lib/common.js";
import { sessionVersion } from "../functions/_lib/auth.js";
import { onRequestPost as bulkWrite, onRequestGet as bulkRead } from "../functions/api/data/index.js";
import { onRequestPut as writeMonth } from "../functions/api/data/month/[month].js";

function makeKV(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: async (key) => (map.has(key) ? map.get(key) : null),
    put: async (key, value) => {
      map.set(key, String(value));
    },
    delete: async (key) => {
      map.delete(key);
    },
  };
}

/**
 * D1 stand-in for the two data routes. Month rows are kept as the exact bind
 * arguments so a test can prove what would have reached `items_json`.
 */
function makeDB(users = new Map()) {
  const months = [];
  return {
    users,
    months,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => {
              if (/SELECT pin_hash FROM users WHERE id = \?/i.test(sql)) {
                const user = users.get(args[0]);
                return user ? { pin_hash: user.pin_hash } : null;
              }
              if (/SELECT salary, items_json, paid_json FROM months/i.test(sql)) {
                const row = months.find((m) => m.user_id === args[0] && m.month === args[1]);
                return row ? { salary: row.salary, items_json: row.items_json, paid_json: row.paid_json } : null;
              }
              throw new Error(`unexpected first(): ${sql}`);
            },
            all: async () => {
              if (/SELECT month, salary, items_json, paid_json FROM months/i.test(sql)) {
                return { results: months.filter((m) => m.user_id === args[0]) };
              }
              throw new Error(`unexpected all(): ${sql}`);
            },
            run: async () => {
              if (/INSERT INTO months/i.test(sql)) {
                const [user_id, month, salary, items_json, paid_json, updated_at] = args;
                const existing = months.find((m) => m.user_id === user_id && m.month === month);
                const row = { user_id, month, salary, items_json, paid_json, updated_at };
                if (existing) Object.assign(existing, row);
                else months.push(row);
                return { success: true };
              }
              throw new Error(`unexpected run(): ${sql}`);
            },
          };
        },
      };
    },
  };
}

const PIN_HASH = "c".repeat(64);
const USER = "alice";

async function makeEnv() {
  const users = new Map([[USER, { pin_hash: PIN_HASH }]]);
  const db = makeDB(users);
  const kv = makeKV();
  const ver = await sessionVersion(PIN_HASH);
  await kv.put("sess:tok", JSON.stringify({ userID: USER, ver }));
  return { SESSIONS: kv, DB: db };
}

function sessionRequest({ method = "GET", body, owner, path = "/api/data" } = {}) {
  return new Request(`https://app.local${path}`, {
    method,
    headers: {
      cookie: "pf_session=tok",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(owner ? { "x-ledger-owner": owner } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

test("sanitizeLedgerPayload keeps finite amounts and cleared values", () => {
  assert.deepEqual(
    sanitizeLedgerPayload({
      salary: "5000",
      items: { rent: 1200, groceries: "42.5", unused: "", broken: "nope" },
      paid: { rent: true, groceries: 1, unused: 0 },
    }),
    {
      salary: 5000,
      items: { rent: 1200, groceries: 42.5, unused: "" },
      paid: { rent: true, groceries: true, unused: false },
    }
  );
});

test("sanitizeLedgerPayload treats a blank salary as unset", () => {
  assert.equal(sanitizeLedgerPayload({ salary: "" }).salary, null);
  assert.equal(sanitizeLedgerPayload({ salary: "   " }).salary, null);
  assert.equal(sanitizeLedgerPayload({}).salary, null);
  assert.equal(sanitizeLedgerPayload({ salary: "abc" }).salary, null);
  assert.equal(sanitizeLedgerPayload({ salary: 0 }).salary, 0);
});

test("sanitizeLedgerPayload rejects unsafe item keys", () => {
  const clean = sanitizeLedgerPayload({
    items: {
      '<img src=x onerror=alert(1)>': 1,
      "bad key": 2,
      "__proto__": 3,
      prototype: 4,
      constructor: 5,
      rent: 7,
    },
    paid: { "<svg>": true, rent: true },
  });

  assert.deepEqual(clean.items, { rent: 7 });
  assert.deepEqual(clean.paid, { rent: true });
});

test("sanitizeLedgerPayload caps stored keys at 500 per section", () => {
  const items = {};
  const paid = {};
  for (let i = 0; i < 650; i += 1) {
    items[`item_${i}`] = i;
    paid[`item_${i}`] = true;
  }

  const clean = sanitizeLedgerPayload({ items, paid });
  assert.equal(Object.keys(clean.items).length, 500);
  assert.equal(Object.keys(clean.paid).length, 500);
});

test("sanitizeLedgerPayload ignores non-object input", () => {
  assert.deepEqual(sanitizeLedgerPayload(null), { salary: null, items: {}, paid: {} });
  assert.deepEqual(sanitizeLedgerPayload("text"), { salary: null, items: {}, paid: {} });
  assert.deepEqual(sanitizeLedgerPayload([1, 2]), { salary: null, items: {}, paid: {} });
  assert.deepEqual(
    sanitizeLedgerPayload({ items: [1, 2], paid: "yes" }),
    { salary: null, items: {}, paid: {} }
  );
});

test("the bulk write route stores sanitized JSON and skips bad months", async () => {
  const env = await makeEnv();

  const response = await bulkWrite({
    env,
    request: sessionRequest({
      method: "POST",
      path: "/api/data",
      body: {
        data: {
          "2026-11": {
            salary: "7500",
            items: { rent: "1200", "<script>": 1 },
            paid: { rent: "yes" },
          },
          "2026-13": { salary: 1, items: {}, paid: {} },
          "not-a-month": { salary: 1, items: {}, paid: {} },
        },
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, migrated: 1 });

  assert.equal(env.DB.months.length, 1);
  const row = env.DB.months[0];
  assert.equal(row.month, "2026-11");
  assert.equal(row.salary, 7500);
  assert.deepEqual(JSON.parse(row.items_json), { rent: 1200 });
  assert.deepEqual(JSON.parse(row.paid_json), { rent: true });
});

test("the bulk write route caps one request at 600 months", async () => {
  const env = await makeEnv();
  const data = {};
  for (let year = 2000; year < 2060; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      data[`${year}-${String(month).padStart(2, "0")}`] = { salary: 1, items: {}, paid: {} };
    }
  }

  const response = await bulkWrite({
    env,
    request: sessionRequest({ method: "POST", path: "/api/data", body: { data } }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, migrated: 600 });
  assert.equal(env.DB.months.length, 600);
});

test("the single-month route rejects impossible months", async () => {
  const env = await makeEnv();

  for (const month of ["2026-13", "2026-00", "2026-1", "abcd-01"]) {
    const response = await writeMonth({
      env,
      params: { month },
      request: sessionRequest({
        method: "PUT",
        path: `/api/data/month/${month}`,
        body: { salary: 1, items: { rent: 1 }, paid: {} },
      }),
    });

    assert.equal(response.status, 400, month);
  }

  assert.equal(env.DB.months.length, 0);
});

test("the single-month route sanitizes the payload before storing it", async () => {
  const env = await makeEnv();

  const response = await writeMonth({
    env,
    params: { month: "2026-11" },
    request: sessionRequest({
      method: "PUT",
      path: "/api/data/month/2026-11",
      body: {
        salary: "  ",
        items: { rent: "1200", "<b>": 5, broken: "NaN" },
        paid: { rent: true, "<b>": true },
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, month: "2026-11" });

  const row = env.DB.months[0];
  assert.equal(row.salary, null);
  assert.deepEqual(JSON.parse(row.items_json), { rent: 1200 });
  assert.deepEqual(JSON.parse(row.paid_json), { rent: true });
});

test("data routes require a live session", async () => {
  const env = await makeEnv();

  const responses = await Promise.all([
    bulkWrite({
      env,
      request: new Request("https://app.local/api/data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    }),
    writeMonth({
      env,
      params: { month: "2026-11" },
      request: new Request("https://app.local/api/data/month/2026-11", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    }),
  ]);

  assert.deepEqual(responses.map((r) => r.status), [401, 401]);
});

test("a ledger stamped with the signed-in owner is accepted", async () => {
  const env = await makeEnv();

  const bulk = await bulkWrite({
    env,
    request: sessionRequest({
      method: "POST",
      owner: USER,
      body: { data: { "2026-11": { salary: 100, items: { rent: 40 }, paid: {} } } },
    }),
  });
  assert.equal(bulk.status, 200);

  const month = await writeMonth({
    env,
    params: { month: "2026-10" },
    request: sessionRequest({
      method: "PUT",
      owner: USER,
      path: "/api/data/month/2026-10",
      body: { salary: 200, items: {}, paid: {} },
    }),
  });
  assert.equal(month.status, 200);

  const read = await bulkRead({ env, request: sessionRequest({ owner: USER }) });
  assert.equal(read.status, 200);
  assert.deepEqual(Object.keys((await read.json()).data).sort(), ["2026-10", "2026-11"]);
});

test("a stale tab writing the previous account's ledger is refused", async () => {
  const env = await makeEnv();

  const bulk = await bulkWrite({
    env,
    request: sessionRequest({
      method: "POST",
      owner: "bob",
      body: { data: { "2026-11": { salary: 100, items: {}, paid: {} } } },
    }),
  });
  assert.equal(bulk.status, 409);
  assert.match((await bulk.json()).error, /different account/i);

  const month = await writeMonth({
    env,
    params: { month: "2026-10" },
    request: sessionRequest({
      method: "PUT",
      owner: "bob",
      path: "/api/data/month/2026-10",
      body: { salary: 200, items: {}, paid: {} },
    }),
  });
  assert.equal(month.status, 409);

  const read = await bulkRead({ env, request: sessionRequest({ owner: "bob" }) });
  assert.equal(read.status, 409);

  assert.equal(env.DB.months.length, 0);
});

test("a request with no owner header keeps working for older clients", async () => {
  const env = await makeEnv();

  const month = await writeMonth({
    env,
    params: { month: "2026-10" },
    request: sessionRequest({
      method: "PUT",
      path: "/api/data/month/2026-10",
      body: { salary: 200, items: {}, paid: {} },
    }),
  });

  assert.equal(month.status, 200);
  assert.equal(env.DB.months.length, 1);
});
