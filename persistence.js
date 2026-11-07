/**
 * persistence.js — one seam for ledger reads and writes.
 *
 * The module owns *how* data is persisted (storage key layout, serialisation,
 * which cloud route, when to debounce). It does not own the model: callers pass
 * the `data` object in, and the module never touches `document`.
 *
 * Two adapters make the seam real:
 *   storage — localStorage in the browser, a Map in tests
 *   request — the app's `api()` in the browser, a recorder in tests
 *
 * `data.__meta` is local-only by contract. The server drops every key that is
 * not `YYYY-MM`, so cloud writes deliberately filter month keys out and leave
 * meta behind on the device.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Persistence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "pf_monthly_finance_v1";
  const ACCOUNT_OWNER_KEY = "pf_account_owner_v1";
  const CLOUD_SYNC_PREFIX = "pf_cloud_migrated_v1";
  const MONTH_RE = /^\d{4}-\d{2}$/;
  const DEFAULT_MONTH = () => ({ salary: "", items: {}, paid: {} });

  function normalizeMeta(data) {
    if (!data.__meta || typeof data.__meta !== "object") {
      data.__meta = { customItems: [], nameOverrides: {} };
    }
    if (!Array.isArray(data.__meta.customItems)) data.__meta.customItems = [];
    if (!Array.isArray(data.__meta.hiddenItems)) data.__meta.hiddenItems = [];
    if (!data.__meta.nameOverrides || typeof data.__meta.nameOverrides !== "object" || Array.isArray(data.__meta.nameOverrides)) {
      data.__meta.nameOverrides = {};
    }
    const budgets = data.__meta.categoryBudgets;
    if (!budgets || typeof budgets !== "object" || Array.isArray(budgets)) {
      data.__meta.categoryBudgets = {};
    }
    return data;
  }

  /** The subset the server accepts: month keys only, meta excluded. */
  function monthKeys(data) {
    const out = {};
    if (!data || typeof data !== "object") return out;
    for (const [key, value] of Object.entries(data)) {
      if (MONTH_RE.test(key)) out[key] = value;
    }
    return out;
  }

  function create({ storage, request, session } = {}) {
    if (!storage || typeof storage.get !== "function") throw new TypeError("persistence: storage adapter required");
    if (typeof request !== "function") throw new TypeError("persistence: request adapter required");
    if (!session || typeof session.isAuthenticated !== "function") {
      throw new TypeError("persistence: session adapter required");
    }

    let timer = null;

    function load() {
      try {
        const raw = storage.get(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        return normalizeMeta(parsed);
      } catch {
        return {};
      }
    }

    function saveLocal(data) {
      storage.set(STORAGE_KEY, JSON.stringify(data));
    }

    /**
     * Debounced local write. `readData` is called when the timer fires so the
     * caller can pass `() => data` and still save the current reference even if
     * it was replaced in the meantime. `onSaved` never runs for a cancelled save.
     */
    function scheduleLocalSave(readData, onSaved, delay = 800) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        saveLocal(readData());
        if (typeof onSaved === "function") onSaved();
      }, delay);
    }

    function cancelScheduledSave() {
      clearTimeout(timer);
      timer = null;
    }

    /** Local write, then one month over the month route when signed in. */
    async function syncMonth(data, month) {
      saveLocal(data);
      if (!session.isAuthenticated()) return { synced: false, reason: "local" };
      const record = (data && data[month]) || DEFAULT_MONTH();
      await request(`/api/data/month/${month}`, {
        method: "PUT",
        body: JSON.stringify(record),
      });
      return { synced: true };
    }

    /** Local write, then the whole ledger over the bulk route when signed in. */
    async function syncAll(data) {
      saveLocal(data);
      if (!session.isAuthenticated()) return { synced: false, reason: "local" };
      await request("/api/data", {
        method: "POST",
        body: JSON.stringify({ data: monthKeys(data) }),
      });
      return { synced: true };
    }

    /** Same as syncAll, but a failed upload never reaches the caller. */
    async function syncAllBestEffort(data) {
      try {
        return await syncAll(data);
      } catch (error) {
        return { synced: false, reason: "error", error };
      }
    }

    function clearData() {
      cancelScheduledSave();
      storage.remove(STORAGE_KEY);
    }

    function getOwner() {
      return storage.get(ACCOUNT_OWNER_KEY) || "";
    }

    function setOwner(userID) {
      if (userID) storage.set(ACCOUNT_OWNER_KEY, String(userID));
    }

    function clearOwner() {
      storage.remove(ACCOUNT_OWNER_KEY);
    }

    function migrationKey(userID) {
      return `${CLOUD_SYNC_PREFIX}:${userID || "default"}`;
    }

    function isMigrated(userID) {
      return storage.get(migrationKey(userID)) === "1";
    }

    function markMigrated(userID) {
      storage.set(migrationKey(userID), "1");
    }

    function clearSyncMarkers() {
      const keys = typeof storage.keys === "function" ? storage.keys() : [];
      for (const key of keys) {
        if (key.startsWith(`${CLOUD_SYNC_PREFIX}:`)) storage.remove(key);
      }
    }

    return {
      load,
      saveLocal,
      scheduleLocalSave,
      cancelScheduledSave,
      syncMonth,
      syncAll,
      syncAllBestEffort,
      clearData,
      getOwner,
      setOwner,
      clearOwner,
      isMigrated,
      markMigrated,
      clearSyncMarkers,
    };
  }

  function browserStorage() {
    return {
      get: (key) => localStorage.getItem(key),
      set: (key, value) => localStorage.setItem(key, value),
      remove: (key) => localStorage.removeItem(key),
      keys: () => Object.keys(localStorage),
    };
  }

  /** Composition root for the page: wires localStorage and the app's api(). */
  function browser({ request, session } = {}) {
    return create({ storage: browserStorage(), request, session });
  }

  return {
    create,
    browser,
    monthKeys,
    normalizeMeta,
    STORAGE_KEY,
    ACCOUNT_OWNER_KEY,
    CLOUD_SYNC_PREFIX,
  };
});
