const test = require("node:test");
const assert = require("node:assert/strict");

const Persistence = require("../persistence.js");

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: (key) => (map.has(key) ? map.get(key) : null),
    set: (key, value) => map.set(key, String(value)),
    remove: (key) => map.delete(key),
    keys: () => [...map.keys()],
    dump: () => Object.fromEntries(map),
  };
}

function makeRequest(handler) {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, options });
    return handler ? handler(path, options) : { ok: true };
  };
  request.calls = calls;
  return request;
}

function makeSession(authenticated = true) {
  const session = { authenticated, isAuthenticated: () => session.authenticated };
  return session;
}

function makePersistence({ authenticated = true, handler, storage = makeStorage() } = {}) {
  const request = makeRequest(handler);
  const session = makeSession(authenticated);
  const persistence = Persistence.create({ storage, request, session });
  return { persistence, storage, request, session };
}

const ledger = {
  __meta: { customItems: [], nameOverrides: {}, hiddenItems: [], categoryBudgets: {} },
  "2026-10": { salary: 100, items: { rent: 40 }, paid: { rent: true } },
  "2026-11": { salary: "", items: {}, paid: {} },
};

test("monthKeys keeps months and drops meta and junk", () => {
  const out = Persistence.monthKeys({
    __meta: { customItems: [] },
    "2026-11": { salary: 1 },
    "2026-1": { salary: 2 },
    note: "x",
  });
  assert.deepEqual(out, { "2026-11": { salary: 1 } });
});

test("monthKeys tolerates non-objects", () => {
  assert.deepEqual(Persistence.monthKeys(null), {});
  assert.deepEqual(Persistence.monthKeys("nope"), {});
});

test("normalizeMeta fills every default and preserves real values", () => {
  const data = { __meta: { customItems: [{ key: "a" }], categoryBudgets: { Food: 10 } } };
  const out = Persistence.normalizeMeta(data);
  assert.equal(out, data);
  assert.deepEqual(out.__meta.customItems, [{ key: "a" }]);
  assert.deepEqual(out.__meta.categoryBudgets, { Food: 10 });
  assert.deepEqual(out.__meta.nameOverrides, {});
  assert.deepEqual(out.__meta.hiddenItems, []);
});

test("normalizeMeta replaces malformed meta pieces", () => {
  const out = Persistence.normalizeMeta({
    __meta: { customItems: "no", nameOverrides: [], hiddenItems: 1, categoryBudgets: [] },
  });
  assert.deepEqual(out.__meta, {
    customItems: [],
    nameOverrides: {},
    hiddenItems: [],
    categoryBudgets: {},
  });
});

test("create requires a storage, request and session adapter", () => {
  assert.throws(() => Persistence.create({}), /storage adapter required/);
  assert.throws(() => Persistence.create({ storage: makeStorage() }), /request adapter required/);
  assert.throws(
    () => Persistence.create({ storage: makeStorage(), request: async () => ({}) }),
    /session adapter required/
  );
});

test("load returns an empty ledger with defaults when nothing is stored", () => {
  const { persistence } = makePersistence();
  assert.deepEqual(persistence.load(), {
    __meta: { customItems: [], nameOverrides: {}, hiddenItems: [], categoryBudgets: {} },
  });
});

test("load returns an empty ledger when storage is corrupt", () => {
  const { persistence } = makePersistence({ storage: makeStorage({ [Persistence.STORAGE_KEY]: "{oops" }) });
  assert.deepEqual(persistence.load(), {});
});

test("load rejects arrays and primitives", () => {
  const array = makePersistence({ storage: makeStorage({ [Persistence.STORAGE_KEY]: "[]" }) });
  assert.deepEqual(array.persistence.load(), {});
  const number = makePersistence({ storage: makeStorage({ [Persistence.STORAGE_KEY]: "7" }) });
  assert.deepEqual(number.persistence.load(), {});
});

test("load normalises meta on the way out", () => {
  const { persistence } = makePersistence({
    storage: makeStorage({ [Persistence.STORAGE_KEY]: JSON.stringify({ "2026-11": ledger["2026-11"] }) }),
  });
  const loaded = persistence.load();
  assert.deepEqual(loaded["2026-11"], ledger["2026-11"]);
  assert.deepEqual(loaded.__meta, {
    customItems: [],
    nameOverrides: {},
    hiddenItems: [],
    categoryBudgets: {},
  });
});

test("saveLocal writes the whole ledger under the storage key", () => {
  const { persistence, storage } = makePersistence();
  persistence.saveLocal(ledger);
  assert.deepEqual(JSON.parse(storage.get(Persistence.STORAGE_KEY)), ledger);
});

test("scheduleLocalSave debounces and only writes the latest read", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { persistence, storage } = makePersistence();
  let saved = 0;

  persistence.scheduleLocalSave(() => ({ tag: "first" }), () => { saved += 1; });
  t.mock.timers.tick(500);
  persistence.scheduleLocalSave(() => ({ tag: "second" }), () => { saved += 1; });
  t.mock.timers.tick(799);
  assert.equal(storage.get(Persistence.STORAGE_KEY), null);

  t.mock.timers.tick(1);
  assert.deepEqual(JSON.parse(storage.get(Persistence.STORAGE_KEY)), { tag: "second" });
  assert.equal(saved, 1);
});

test("scheduleLocalSave reads data when the timer fires, not when it is scheduled", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { persistence, storage } = makePersistence();
  let data = { tag: "old" };

  persistence.scheduleLocalSave(() => data);
  data = { tag: "new" };
  t.mock.timers.tick(800);

  assert.deepEqual(JSON.parse(storage.get(Persistence.STORAGE_KEY)), { tag: "new" });
});

test("cancelScheduledSave drops the pending write", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { persistence, storage } = makePersistence();
  let saved = 0;

  persistence.scheduleLocalSave(() => ({ tag: "never" }), () => { saved += 1; });
  persistence.cancelScheduledSave();
  t.mock.timers.tick(800);

  assert.equal(storage.get(Persistence.STORAGE_KEY), null);
  assert.equal(saved, 0);
});

test("syncMonth writes locally without a request when signed out", async () => {
  const { persistence, storage, request } = makePersistence({ authenticated: false });
  const result = await persistence.syncMonth(ledger, "2026-11");
  assert.deepEqual(result, { synced: false, reason: "local" });
  assert.equal(request.calls.length, 0);
  assert.deepEqual(JSON.parse(storage.get(Persistence.STORAGE_KEY)), ledger);
});

test("syncMonth PUTs only that month when signed in", async () => {
  const { persistence, storage, request } = makePersistence();
  const result = await persistence.syncMonth(ledger, "2026-10");

  assert.deepEqual(result, { synced: true });
  assert.equal(request.calls.length, 1);
  assert.equal(request.calls[0].path, "/api/data/month/2026-10");
  assert.equal(request.calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(request.calls[0].options.body), ledger["2026-10"]);
  assert.deepEqual(JSON.parse(storage.get(Persistence.STORAGE_KEY)), ledger);
});

test("syncMonth sends a blank record for a month the ledger lacks", async () => {
  const { persistence, request } = makePersistence();
  await persistence.syncMonth({}, "2025-01");
  assert.deepEqual(JSON.parse(request.calls[0].options.body), { salary: "", items: {}, paid: {} });
});

test("syncAll POSTs month keys only, never meta", async () => {
  const { persistence, storage, request } = makePersistence();
  const result = await persistence.syncAll(ledger);

  assert.deepEqual(result, { synced: true });
  assert.equal(request.calls[0].path, "/api/data");
  assert.equal(request.calls[0].options.method, "POST");
  const body = JSON.parse(request.calls[0].options.body);
  assert.deepEqual(Object.keys(body), ["data"]);
  assert.deepEqual(body.data, { "2026-10": ledger["2026-10"], "2026-11": ledger["2026-11"] });
  assert.deepEqual(JSON.parse(storage.get(Persistence.STORAGE_KEY)), ledger);
});

test("syncAll saves locally without a request when signed out", async () => {
  const { persistence, request, storage } = makePersistence({ authenticated: false });
  assert.deepEqual(await persistence.syncAll(ledger), { synced: false, reason: "local" });
  assert.equal(request.calls.length, 0);
  assert.deepEqual(JSON.parse(storage.get(Persistence.STORAGE_KEY)), ledger);
});

test("syncAllBestEffort swallows request failures after the local write", async () => {
  const { persistence, storage } = makePersistence({
    handler: async () => { throw new Error("offline"); },
  });
  const result = await persistence.syncAllBestEffort(ledger);

  assert.equal(result.synced, false);
  assert.equal(result.reason, "error");
  assert.equal(result.error.message, "offline");
  assert.deepEqual(JSON.parse(storage.get(Persistence.STORAGE_KEY)), ledger);
});

test("syncAllBestEffort reports a successful sync", async () => {
  const { persistence } = makePersistence();
  assert.deepEqual(await persistence.syncAllBestEffort(ledger), { synced: true });
});

test("clearData drops the ledger and any pending save", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { persistence, storage } = makePersistence({
    storage: makeStorage({ [Persistence.STORAGE_KEY]: JSON.stringify(ledger) }),
  });
  persistence.scheduleLocalSave(() => ({ revived: true }));
  persistence.clearData();
  t.mock.timers.tick(800);
  assert.equal(storage.get(Persistence.STORAGE_KEY), null);
});

test("account owner round-trips and ignores an empty id", () => {
  const { persistence, storage } = makePersistence();
  assert.equal(persistence.getOwner(), "");

  persistence.setOwner(42);
  assert.equal(persistence.getOwner(), "42");
  assert.equal(storage.get(Persistence.ACCOUNT_OWNER_KEY), "42");

  persistence.setOwner("");
  assert.equal(persistence.getOwner(), "42");

  persistence.clearOwner();
  assert.equal(persistence.getOwner(), "");
});

test("migration markers are per user", () => {
  const { persistence } = makePersistence();
  assert.equal(persistence.isMigrated("u1"), false);

  persistence.markMigrated("u1");
  assert.equal(persistence.isMigrated("u1"), true);
  assert.equal(persistence.isMigrated("u2"), false);
});

test("migration markers fall back to a default key", () => {
  const { persistence } = makePersistence();
  persistence.markMigrated("");
  assert.equal(persistence.isMigrated(""), true);
  assert.equal(persistence.isMigrated(null), true);
});

test("clearSyncMarkers removes every marker and nothing else", () => {
  const { persistence, storage } = makePersistence({
    storage: makeStorage({
      "pf_cloud_migrated_v1:u1": "1",
      "pf_cloud_migrated_v1:u2": "1",
      [Persistence.STORAGE_KEY]: "{}",
    }),
  });

  persistence.clearSyncMarkers();

  assert.deepEqual(storage.dump(), { [Persistence.STORAGE_KEY]: "{}" });
});

test("browser() wires localStorage and keeps the caller's adapters", async () => {
  const original = globalThis.localStorage;
  const map = new Map();
  globalThis.localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
  const request = makeRequest();

  try {
    const persistence = Persistence.browser({ request, session: makeSession(true) });
    persistence.saveLocal(ledger);
    assert.deepEqual(persistence.load(), ledger);
    await persistence.syncAll(ledger);
    assert.equal(request.calls[0].path, "/api/data");
  } finally {
    globalThis.localStorage = original;
  }
});
