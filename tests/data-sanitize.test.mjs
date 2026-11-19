import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeLedgerPayload, sanitizeSettingsPayload } from "../functions/_lib/common.js";
import { sessionVersion } from "../functions/_lib/auth.js";
import { onRequestPost as bulkWrite, onRequestGet as bulkRead } from "../functions/api/data/index.js";
import { onRequestPut as writeMonth, onRequestGet as readMonth } from "../functions/api/data/month/[month].js";
import {
  onRequestGet as readSettings,
  onRequestPut as writeSettings,
} from "../functions/api/settings/index.js";

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
 * D1 stand-in for the data and settings routes.
 *
 * Rows keep the exact bind arguments so a test can prove what would have
 * reached `items_json`. The versioned upserts model `ON CONFLICT ... WHERE`:
 * a stale base version reports `meta.changes === 0`, exactly like D1, which is
 * what the handlers turn into a 409.
 */
function makeDB(users = new Map()) {
  const months = [];
  const settings = new Map();

  function upsertMonth(sql, args) {
    const [user_id, month, salary, items_json, paid_json, updated_at, baseVersion] = args;
    const conditional = /WHERE\s+months\.version\s*=\s*\?/i.test(sql);
    const existing = months.find((m) => m.user_id === user_id && m.month === month);

    if (existing) {
      if (conditional && existing.version !== baseVersion) {
        return { success: true, meta: { changes: 0 } };
      }
      Object.assign(existing, {
        salary,
        items_json,
        paid_json,
        version: existing.version + 1,
        updated_at,
      });
      return { success: true, meta: { changes: 1 } };
    }

    months.push({ user_id, month, salary, items_json, paid_json, version: 1, updated_at });
    return { success: true, meta: { changes: 1 } };
  }

  function upsertSettings(sql, args) {
    const [user_id, json, updated_at, baseVersion] = args;
    const conditional = /WHERE\s+user_settings\.version\s*=\s*\?/i.test(sql);
    const existing = settings.get(user_id);

    if (existing) {
      if (conditional && existing.version !== baseVersion) {
        return { success: true, meta: { changes: 0 } };
      }
      settings.set(user_id, { json, version: existing.version + 1, updated_at });
      return { success: true, meta: { changes: 1 } };
    }

    settings.set(user_id, { json, version: 1, updated_at });
    return { success: true, meta: { changes: 1 } };
  }

  return {
    users,
    months,
    settings,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => {
              if (/SELECT pin_hash FROM users WHERE id = \?/i.test(sql)) {
                const user = users.get(args[0]);
                return user ? { pin_hash: user.pin_hash } : null;
              }
              if (/SELECT salary, items_json, paid_json, version FROM months/i.test(sql)) {
                const row = months.find((m) => m.user_id === args[0] && m.month === args[1]);
                return row
                  ? {
                      salary: row.salary,
                      items_json: row.items_json,
                      paid_json: row.paid_json,
                      version: row.version,
                    }
                  : null;
              }
              if (/SELECT version FROM months WHERE user_id = \? AND month = \?/i.test(sql)) {
                const row = months.find((m) => m.user_id === args[0] && m.month === args[1]);
                return row ? { version: row.version } : null;
              }
              if (/SELECT json, version, updated_at FROM user_settings/i.test(sql)) {
                const row = settings.get(args[0]);
                return row ? { json: row.json, version: row.version, updated_at: row.updated_at } : null;
              }
              throw new Error(`unexpected first(): ${sql}`);
            },
            all: async () => {
              if (/SELECT month, salary, items_json, paid_json, version FROM months/i.test(sql)) {
                return { results: months.filter((m) => m.user_id === args[0]) };
              }
              if (/SELECT month, version FROM months WHERE user_id = \?/i.test(sql)) {
                return {
                  results: months
                    .filter((m) => m.user_id === args[0])
                    .map((m) => ({ month: m.month, version: m.version })),
                };
              }
              throw new Error(`unexpected all(): ${sql}`);
            },
            run: async () => {
              if (/INSERT INTO months/i.test(sql)) return upsertMonth(sql, args);
              if (/INSERT INTO user_settings/i.test(sql)) return upsertSettings(sql, args);
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

function putMonth(env, month, body, options = {}) {
  return writeMonth({
    env,
    params: { month },
    request: sessionRequest({
      method: "PUT",
      path: `/api/data/month/${month}`,
      body,
      ...options,
    }),
  });
}

function settingsRequest(method, body, options = {}) {
  return sessionRequest({
    method,
    path: "/api/settings",
    ...(body !== undefined ? { body } : {}),
    ...options,
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

test("sanitizeSettingsPayload keeps real customisations and drops junk", () => {
  const clean = sanitizeSettingsPayload({
    customItems: [
      {
        key: "pet_food",
        name: "  Pet food  ",
        category: "Food",
        kind: "investment",
        fixed: false,
        defaultAmount: "300",
      },
      { key: "bad key", name: "Bad", defaultAmount: 1 },
      { key: "__proto__", name: "Proto" },
      { key: "no_name", name: "   " },
      { key: "bad_amount", name: "Keep", defaultAmount: "nope", fixed: true },
      "nope",
    ],
    hiddenItems: ["rent", "rent", "__proto__", "bad key"],
    nameOverrides: { rent: "  Rent  ", ["bad key"]: "y", ["__proto__"]: "x" },
    categoryBudgets: { Food: "500", Travel: -1, "": 10, Calories: 2.6, ["__proto__"]: 5 },
  });

  assert.deepEqual(clean.customItems, [
    {
      key: "pet_food",
      name: "Pet food",
      kind: "expense",
      fixed: false,
      defaultAmount: 300,
      category: "Food",
    },
    { key: "bad_amount", name: "Keep", kind: "expense", fixed: true, defaultAmount: null },
  ]);
  assert.deepEqual(clean.hiddenItems, ["rent"]);
  assert.deepEqual(clean.nameOverrides, { rent: "Rent" });
  assert.deepEqual(clean.categoryBudgets, { Food: 500, Calories: 3 });
});

test("sanitizeSettingsPayload caps labels and totals", () => {
  const longName = "x".repeat(200);
  const control = `bad\u0000name\u001f`;

  const clean = sanitizeSettingsPayload({
    customItems: [{ key: "long", name: longName }],
    nameOverrides: { rent: control },
  });

  assert.equal(clean.customItems[0].name.length, 80);
  assert.equal(clean.nameOverrides.rent, "badname");
});

test("sanitizeSettingsPayload caps each collection", () => {
  const customItems = [];
  const nameOverrides = {};
  for (let i = 0; i < 260; i += 1) {
    customItems.push({ key: `item_${i}`, name: `Item ${i}` });
    nameOverrides[`item_${i}`] = `Name ${i}`;
  }

  const clean = sanitizeSettingsPayload({ customItems, nameOverrides });
  assert.equal(clean.customItems.length, 200);
  assert.equal(Object.keys(clean.nameOverrides).length, 200);
});

test("sanitizeSettingsPayload always returns the full shape", () => {
  for (const input of [null, "text", [1, 2], 7]) {
    assert.deepEqual(sanitizeSettingsPayload(input), {
      customItems: [],
      hiddenItems: [],
      nameOverrides: {},
      categoryBudgets: {},
    });
  }
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
  const payload = await response.json();
  assert.equal(payload.migrated, 1);
  assert.deepEqual(payload.versions, { "2026-11": 1 });

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
  const payload = await response.json();
  assert.equal(payload.migrated, 600);
  assert.equal(Object.keys(payload.versions).length, 600);
  assert.equal(env.DB.months.length, 600);
});

test("the bulk routes report versions, and a rewrite bumps them", async () => {
  const env = await makeEnv();
  const write = (salary) =>
    bulkWrite({
      env,
      request: sessionRequest({
        method: "POST",
        body: { data: { "2026-10": { salary, items: {}, paid: {} } } },
      }),
    });

  await write(1);
  const first = await (await bulkRead({ env, request: sessionRequest() })).json();
  assert.deepEqual(first.versions, { "2026-10": 1 });

  await write(2);
  const second = await (await bulkRead({ env, request: sessionRequest() })).json();
  assert.deepEqual(second.versions, { "2026-10": 2 });
  assert.equal(second.data["2026-10"].salary, 2);
});

test("the single-month route rejects impossible months", async () => {
  const env = await makeEnv();

  for (const month of ["2026-13", "2026-00", "2026-1", "abcd-01"]) {
    const response = await putMonth(env, month, { salary: 1, items: { rent: 1 }, paid: {} });
    assert.equal(response.status, 400, month);
  }

  assert.equal(env.DB.months.length, 0);
});

test("the single-month route sanitizes the payload before storing it", async () => {
  const env = await makeEnv();

  const response = await putMonth(env, "2026-11", {
    salary: "  ",
    items: { rent: "1200", "<b>": 5, broken: "NaN" },
    paid: { rent: true, "<b>": true },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, month: "2026-11", version: 1 });

  const row = env.DB.months[0];
  assert.equal(row.salary, null);
  assert.deepEqual(JSON.parse(row.items_json), { rent: 1200 });
  assert.deepEqual(JSON.parse(row.paid_json), { rent: true });
});

test("a versioned write creates the month once and then refuses a stale create", async () => {
  const env = await makeEnv();

  const first = await putMonth(env, "2026-11", {
    salary: 500,
    items: { rent: 200 },
    paid: {},
    baseVersion: 0,
  });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, month: "2026-11", version: 1 });

  const second = await putMonth(env, "2026-11", {
    salary: 999,
    items: {},
    paid: {},
    baseVersion: 0,
  });
  assert.equal(second.status, 409);

  const conflict = await second.json();
  assert.equal(conflict.code, "version_conflict");
  assert.equal(conflict.version, 1);
  assert.deepEqual(conflict.current, { salary: 500, items: { rent: 200 }, paid: {} });
  assert.equal(env.DB.months[0].salary, 500);
  assert.equal(env.DB.months[0].version, 1);
});

test("a stale base version is refused and the retry with the current one succeeds", async () => {
  const env = await makeEnv();

  await putMonth(env, "2026-11", { salary: 100, items: {}, paid: {}, baseVersion: 0 });

  const stale = await putMonth(env, "2026-11", { salary: 200, items: {}, paid: {}, baseVersion: 0 });
  assert.equal(stale.status, 409);
  assert.equal(env.DB.months[0].salary, 100);

  const retry = await putMonth(env, "2026-11", { salary: 200, items: {}, paid: {}, baseVersion: 1 });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { ok: true, month: "2026-11", version: 2 });
  assert.equal(env.DB.months[0].salary, 200);
});

test("a legacy write without baseVersion still overwrites and bumps the version", async () => {
  const env = await makeEnv();

  const first = await putMonth(env, "2026-11", { salary: 100, items: {}, paid: {} });
  assert.deepEqual(await first.json(), { ok: true, month: "2026-11", version: 1 });

  const second = await putMonth(env, "2026-11", { salary: 300, items: {}, paid: {} });
  assert.deepEqual(await second.json(), { ok: true, month: "2026-11", version: 2 });
  assert.equal(env.DB.months[0].salary, 300);
});

test("the single-month GET returns the stored record and its version", async () => {
  const env = await makeEnv();
  await putMonth(env, "2026-11", { salary: 100, items: { rent: 40 }, paid: { rent: true } });

  const response = await readMonth({
    env,
    params: { month: "2026-11" },
    request: sessionRequest({ path: "/api/data/month/2026-11" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    month: "2026-11",
    data: { salary: 100, items: { rent: 40 }, paid: { rent: true } },
    version: 1,
  });
});

test("the single-month GET reports a missing month as version 0", async () => {
  const env = await makeEnv();

  const response = await readMonth({
    env,
    params: { month: "2026-09" },
    request: sessionRequest({ path: "/api/data/month/2026-09" }),
  });

  assert.deepEqual(await response.json(), { ok: true, month: "2026-09", data: null, version: 0 });
});

test("settings start empty and a first write seeds version 1", async () => {
  const env = await makeEnv();

  const empty = await readSettings({ env, request: settingsRequest("GET") });
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { ok: true, settings: null, version: 0, updatedAt: null });

  const seeded = await writeSettings({
    env,
    request: settingsRequest("PUT", { settings: { categoryBudgets: { Food: "500" } }, baseVersion: 0 }),
  });
  assert.equal(seeded.status, 200);
  assert.equal((await seeded.json()).version, 1);

  const stored = await (await readSettings({ env, request: settingsRequest("GET") })).json();
  assert.equal(stored.version, 1);
  assert.deepEqual(stored.settings, {
    customItems: [],
    hiddenItems: [],
    nameOverrides: {},
    categoryBudgets: { Food: 500 },
  });
  assert.equal(typeof stored.updatedAt, "number");
});

test("a stale settings write is refused and hands back the stored copy", async () => {
  const env = await makeEnv();
  const write = (budget, baseVersion) =>
    writeSettings({
      env,
      request: settingsRequest("PUT", { settings: { categoryBudgets: { Food: budget } }, baseVersion }),
    });

  await write(500, 0);

  const stale = await write(999, 0);
  assert.equal(stale.status, 409);
  const conflict = await stale.json();
  assert.equal(conflict.code, "version_conflict");
  assert.equal(conflict.version, 1);
  assert.deepEqual(conflict.settings.categoryBudgets, { Food: 500 });

  const retry = await write(999, 1);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).version, 2);
  assert.deepEqual(env.DB.settings.get(USER).json, JSON.stringify({
    customItems: [],
    hiddenItems: [],
    nameOverrides: {},
    categoryBudgets: { Food: 999 },
  }));
});

test("a settings write without baseVersion still overwrites for an older client", async () => {
  const env = await makeEnv();
  const write = (settings) => writeSettings({ env, request: settingsRequest("PUT", { settings }) });

  assert.equal((await (await write({ categoryBudgets: { Food: 100 } })).json()).version, 1);
  assert.equal((await (await write({ categoryBudgets: { Food: 200 } })).json()).version, 2);
  assert.deepEqual(JSON.parse(env.DB.settings.get(USER).json).categoryBudgets, { Food: 200 });
});

test("settings are sanitized before they are stored", async () => {
  const env = await makeEnv();

  await writeSettings({
    env,
    request: settingsRequest("PUT", {
      settings: {
        customItems: [{ key: "<script>", name: "x" }, { key: "ok", name: "Fine" }],
        categoryBudgets: { Food: "not a number" },
      },
      baseVersion: 0,
    }),
  });

  assert.deepEqual(JSON.parse(env.DB.settings.get(USER).json), {
    customItems: [{ key: "ok", name: "Fine", kind: "expense", fixed: false, defaultAmount: null }],
    hiddenItems: [],
    nameOverrides: {},
    categoryBudgets: {},
  });
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

test("settings routes require a live session", async () => {
  const env = await makeEnv();

  assert.equal(
    (await readSettings({ env, request: new Request("https://app.local/api/settings") })).status,
    401
  );
  assert.equal(
    (
      await writeSettings({
        env,
        request: new Request("https://app.local/api/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      })
    ).status,
    401
  );
  assert.equal(env.DB.settings.size, 0);
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

  const month = await putMonth(
    env,
    "2026-10",
    { salary: 200, items: {}, paid: {} },
    { owner: USER }
  );
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

  const month = await putMonth(env, "2026-10", { salary: 200, items: {}, paid: {} }, { owner: "bob" });
  assert.equal(month.status, 409);

  const read = await bulkRead({ env, request: sessionRequest({ owner: "bob" }) });
  assert.equal(read.status, 409);

  assert.equal(env.DB.months.length, 0);
});

test("settings stamped with another account are refused", async () => {
  const env = await makeEnv();

  const write = await writeSettings({
    env,
    request: settingsRequest("PUT", { settings: { categoryBudgets: { Food: 1 } }, baseVersion: 0 }, { owner: "bob" }),
  });
  assert.equal(write.status, 409);

  const read = await readSettings({ env, request: settingsRequest("GET", undefined, { owner: "bob" }) });
  assert.equal(read.status, 409);

  assert.equal(env.DB.settings.size, 0);
});

test("a request with no owner header keeps working for older clients", async () => {
  const env = await makeEnv();

  const month = await putMonth(env, "2026-10", { salary: 200, items: {}, paid: {} });

  assert.equal(month.status, 200);
  assert.equal(env.DB.months.length, 1);
});

test("settings keep account-owned categories, items and currency", () => {
  const clean = sanitizeSettingsPayload({
    currency: "usd",
    onboarded: true,
    categories: [
      { name: " Bills ", bucket: "needs", icon: "ph:tag-bold", color: "#18815A" },
      { name: "bills", bucket: "wants" },
      { name: "Fun", bucket: "nonsense", icon: "<script>", color: "red" },
    ],
    items: [
      { key: "rent", name: "Rent", category: "Bills", kind: "investment", fixed: true },
      { key: "bad key", name: "Bad", category: "Bills" },
      { key: "orphan", name: "Orphan", category: "Nowhere" },
      { key: "nameless", name: "  ", category: "Bills" },
    ],
  });

  assert.equal(clean.currency, "USD");
  assert.equal(clean.onboarded, true);
  assert.deepEqual(clean.categories, [
    { name: "Bills", bucket: "needs", icon: "ph:tag-bold", color: "#18815A" },
    { name: "Fun", bucket: "needs", icon: "ph:tag-bold", color: "#0B3D2E" },
  ]);
  assert.deepEqual(clean.items, [
    { key: "rent", name: "Rent", category: "Bills", kind: "investment", fixed: true },
  ]);
});

test("settings omit Phase 3 fields the client did not send", () => {
  const clean = sanitizeSettingsPayload({ categoryBudgets: { Food: 100 } });

  assert.equal(Object.prototype.hasOwnProperty.call(clean, "currency"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(clean, "categories"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(clean, "items"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(clean, "onboarded"), false);
});

test("an older tab cannot blank account categories by saving a budget", async () => {
  const env = await makeEnv();

  await writeSettings({
    env,
    request: settingsRequest("PUT", {
      settings: {
        currency: "USD",
        onboarded: true,
        categories: [{ name: "Bills", bucket: "needs", icon: "ph:tag-bold", color: "#18815A" }],
        items: [{ key: "rent", name: "Rent", category: "Bills", kind: "expense", fixed: true }],
      },
      baseVersion: 0,
    }),
  });

  // Phase 2 client: only the legacy keys, no Phase 3 keys at all.
  const write = await writeSettings({
    env,
    request: settingsRequest("PUT", {
      settings: { categoryBudgets: { Bills: 500 } },
      baseVersion: 1,
    }),
  });
  assert.equal(write.status, 200);

  const stored = JSON.parse(env.DB.settings.get(USER).json);
  assert.equal(stored.currency, "USD");
  assert.equal(stored.onboarded, true);
  assert.deepEqual(stored.categories, [
    { name: "Bills", bucket: "needs", icon: "ph:tag-bold", color: "#18815A" },
  ]);
  assert.deepEqual(stored.items, [
    { key: "rent", name: "Rent", category: "Bills", kind: "expense", fixed: true },
  ]);
  assert.deepEqual(stored.categoryBudgets, { Bills: 500 });
});

test("an explicit empty ledger clears it", async () => {
  const env = await makeEnv();

  await writeSettings({
    env,
    request: settingsRequest("PUT", {
      settings: {
        categories: [{ name: "Bills", bucket: "needs", icon: "ph:tag-bold", color: "#18815A" }],
        items: [{ key: "rent", name: "Rent", category: "Bills" }],
      },
      baseVersion: 0,
    }),
  });

  await writeSettings({
    env,
    request: settingsRequest("PUT", {
      settings: { categories: [], items: [], onboarded: true },
      baseVersion: 1,
    }),
  });

  const stored = JSON.parse(env.DB.settings.get(USER).json);
  assert.deepEqual(stored.categories, []);
  assert.deepEqual(stored.items, []);
  assert.equal(stored.onboarded, true);
});
