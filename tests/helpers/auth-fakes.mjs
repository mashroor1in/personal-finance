/**
 * In-memory stand-ins for the D1 and KV bindings.
 *
 * `makeDB` understands exactly the statements the auth handlers issue and
 * throws on anything else, so a test also proves that no unexpected query ran.
 * It models the parts of D1 the code relies on: `first`, `all`, `run` with
 * `meta.changes`, and `batch`.
 */
import { sessionVersion } from "../../functions/_lib/auth.js";

export function makeKV(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: async (key) => (map.has(key) ? map.get(key) : null),
    put: async (key, value) => {
      map.set(key, String(value));
    },
    delete: async (key) => {
      map.delete(key);
    },
    entries: () => [...map.entries()],
  };
}

export function makeDB(users = new Map()) {
  const throttle = new Map();
  const recoveryCodes = new Map();
  const months = new Map();
  const deletedMonths = new Map();
  let pinLookups = 0;

  const monthKey = (userID, month) => `${userID}|${month}`;

  function countCodes(userID) {
    let total = 0;
    let remaining = 0;
    for (const row of recoveryCodes.values()) {
      if (row.user_id !== userID) continue;
      total += 1;
      if (row.used_at === null) remaining += 1;
    }
    return { total, remaining };
  }

  return {
    users,
    throttle,
    recoveryCodes,
    months,
    deletedMonths,
    pinLookups: () => pinLookups,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            sql,
            args,
            first: async () => {
              if (/SELECT id, salt, pin_hash FROM users WHERE id = \?/i.test(sql)) {
                pinLookups += 1;
                const user = users.get(args[0]);
                return user ? { id: args[0], salt: user.salt, pin_hash: user.pin_hash } : null;
              }
              if (/SELECT pin_hash FROM users WHERE id = \?/i.test(sql)) {
                const user = users.get(args[0]);
                return user ? { pin_hash: user.pin_hash } : null;
              }
              if (/SELECT created_at, updated_at, pin_hash FROM users WHERE id = \?/i.test(sql)) {
                const user = users.get(args[0]);
                return user
                  ? {
                      created_at: user.created_at,
                      updated_at: user.updated_at,
                      pin_hash: user.pin_hash,
                    }
                  : null;
              }
              if (/SELECT id FROM users WHERE id = \?/i.test(sql)) {
                return users.has(args[0]) ? { id: args[0] } : null;
              }
              if (/FROM recovery_codes WHERE user_id = \?$/i.test(sql)) {
                const { total, remaining } = countCodes(args[0]);
                return { total, remaining };
              }
              if (/SELECT count, lock_until FROM auth_throttle WHERE key = \?/i.test(sql)) {
                const row = throttle.get(args[0]);
                return row ? { count: row.count, lock_until: row.lock_until } : null;
              }
              throw new Error(`unexpected first(): ${sql}`);
            },
            all: async () => {
              if (/FROM recovery_codes WHERE user_id = \? AND used_at IS NULL/i.test(sql)) {
                const results = [];
                for (const row of recoveryCodes.values()) {
                  if (row.user_id === args[0] && row.used_at === null) {
                    results.push({ id: row.id, salt: row.salt, code_hash: row.code_hash });
                  }
                }
                return { results };
              }
              if (/SELECT month, salary, items_json, paid_json FROM months WHERE user_id = \?/i.test(sql)) {
                const results = [];
                for (const row of months.values()) {
                  if (row.user_id !== args[0]) continue;
                  results.push({
                    month: row.month,
                    salary: row.salary,
                    items_json: row.items_json,
                    paid_json: row.paid_json,
                  });
                }
                results.sort((a, b) => a.month.localeCompare(b.month));
                return { results };
              }
              throw new Error(`unexpected all(): ${sql}`);
            },
            run: async () => {
              if (/INSERT INTO users/i.test(sql)) {
                const [id, salt, pin_hash, updated_at] = args;
                users.set(id, { salt, pin_hash, updated_at, created_at: updated_at });
                return { success: true, meta: { changes: 1 } };
              }
              if (/UPDATE users SET salt = \?, pin_hash = \?, updated_at = \? WHERE id = \?/i.test(sql)) {
                const [salt, pin_hash, updated_at, id] = args;
                const user = users.get(id);
                if (!user) return { success: false, meta: { changes: 0 } };
                users.set(id, { ...user, salt, pin_hash, updated_at });
                return { success: true, meta: { changes: 1 } };
              }
              // Rehash-on-login: upgrades the verifier without touching the
              // password's `updated_at` date.
              if (/UPDATE users SET salt = \?, pin_hash = \? WHERE id = \?/i.test(sql)) {
                const [salt, pin_hash, id] = args;
                const user = users.get(id);
                if (!user) return { success: false, meta: { changes: 0 } };
                users.set(id, { ...user, salt, pin_hash });
                return { success: true, meta: { changes: 1 } };
              }
              if (/INSERT INTO deleted_months/i.test(sql)) {
                const [deletedAt, purgeAfter, userID] = args;
                let changes = 0;
                for (const row of months.values()) {
                  if (row.user_id !== userID) continue;
                  deletedMonths.set(monthKey(userID, row.month), {
                    ...row,
                    deleted_at: deletedAt,
                    purge_after: purgeAfter,
                  });
                  changes += 1;
                }
                return { success: true, meta: { changes } };
              }
              if (/DELETE FROM months WHERE user_id = \?/i.test(sql)) {
                let changes = 0;
                for (const [key, row] of months) {
                  if (row.user_id === args[0]) {
                    months.delete(key);
                    changes += 1;
                  }
                }
                return { success: true, meta: { changes } };
              }
              if (/DELETE FROM deleted_months WHERE purge_after <= \?/i.test(sql)) {
                let changes = 0;
                for (const [key, row] of deletedMonths) {
                  if (row.purge_after <= args[0]) {
                    deletedMonths.delete(key);
                    changes += 1;
                  }
                }
                return { success: true, meta: { changes } };
              }
              if (/DELETE FROM recovery_codes WHERE user_id = \?/i.test(sql)) {
                let changes = 0;
                for (const [id, row] of recoveryCodes) {
                  if (row.user_id === args[0]) {
                    recoveryCodes.delete(id);
                    changes += 1;
                  }
                }
                return { success: true, meta: { changes } };
              }
              if (/INSERT INTO recovery_codes/i.test(sql)) {
                const [id, user_id, code_hash, salt, created_at] = args;
                recoveryCodes.set(id, {
                  id,
                  user_id,
                  code_hash,
                  salt,
                  used_at: null,
                  created_at,
                });
                return { success: true, meta: { changes: 1 } };
              }
              if (/UPDATE recovery_codes SET used_at = \? WHERE id = \? AND used_at IS NULL/i.test(sql)) {
                const [used_at, id] = args;
                const row = recoveryCodes.get(id);
                if (!row || row.used_at !== null) {
                  return { success: true, meta: { changes: 0 } };
                }
                row.used_at = used_at;
                return { success: true, meta: { changes: 1 } };
              }
              if (/DELETE FROM users WHERE id = \?/i.test(sql)) {
                const existed = users.delete(args[0]);
                return { success: true, meta: { changes: existed ? 1 : 0 } };
              }
              if (/UPDATE auth_throttle\s+SET count = 0/i.test(sql)) {
                const [windowStart, updatedAt, key, now, staleBefore] = args;
                const row = throttle.get(key);
                if (row && row.lock_until <= now && (row.lock_until > 0 || row.window_start < staleBefore)) {
                  row.count = 0;
                  row.lock_until = 0;
                  row.window_start = windowStart;
                  row.updated_at = updatedAt;
                }
                return { success: true, meta: { changes: 0 } };
              }
              if (/INSERT INTO auth_throttle/i.test(sql)) {
                const [
                  key,
                  windowStart,
                  insertedAt,
                  nowForCount,
                  nowForLock,
                  limit,
                  nowForExpiry,
                  baseLockMs,
                  limitForExponent,
                  maxLockMs,
                  updatedAt,
                ] = args;
                const row = throttle.get(key);
                if (!row) {
                  throttle.set(key, {
                    count: 1,
                    window_start: windowStart,
                    lock_until: 0,
                    updated_at: insertedAt,
                  });
                } else if (row.lock_until <= nowForCount) {
                  row.count += 1;
                  if (row.count > limit) {
                    const exponent = Math.min(row.count - (limitForExponent + 1), 10);
                    const lockMs = Math.min(baseLockMs * (2 ** exponent), maxLockMs);
                    row.lock_until = Math.max(row.lock_until, nowForExpiry + lockMs);
                  } else {
                    row.lock_until = 0;
                  }
                  row.updated_at = updatedAt;
                }
                return { success: true, meta: { changes: 1 } };
              }
              if (/UPDATE auth_throttle SET count = MAX\(count - 1, 0\)/i.test(sql)) {
                const [key, now] = args;
                const row = throttle.get(key);
                if (row && row.lock_until <= now) row.count = Math.max(row.count - 1, 0);
                return { success: true, meta: { changes: 0 } };
              }
              if (/DELETE FROM auth_throttle WHERE key = \?/i.test(sql)) {
                throttle.delete(args[0]);
                return { success: true, meta: { changes: 1 } };
              }
              throw new Error(`unexpected run(): ${sql}`);
            },
          };
        },
      };
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
}

export function addUser(users, id, pinHash, salt = "salt") {
  users.set(id, {
    salt,
    pin_hash: pinHash,
    created_at: 1,
    updated_at: 1,
  });
}

/** Seed one live ledger row, as the data endpoint would have written it. */
export function addMonth(db, userID, month, { salary = 0, items = {}, paid = {} } = {}) {
  db.months.set(`${userID}|${month}`, {
    user_id: userID,
    month,
    salary,
    items_json: JSON.stringify(items),
    paid_json: JSON.stringify(paid),
    updated_at: 1,
    created_at: 1,
  });
}

/** Seed a trash row, to model a deletion from an earlier day. */
export function addDeletedMonth(db, userID, month, purgeAfter, { salary = 0 } = {}) {
  db.deletedMonths.set(`${userID}|${month}`, {
    user_id: userID,
    month,
    salary,
    items_json: "{}",
    paid_json: "{}",
    updated_at: 1,
    created_at: 1,
    deleted_at: 1,
    purge_after: purgeAfter,
  });
}

export function sessionRequest(token, path = "/api/data") {
  return new Request(`https://app.local${path}`, {
    headers: token ? { cookie: `pf_session=${token}` } : {},
  });
}

export async function seedSession(kv, userID, pinHash) {
  const token = `tok_${Math.random().toString(36).slice(2)}`;
  const ver = await sessionVersion(pinHash);
  await kv.put(`sess:${token}`, JSON.stringify({ userID, ver }));
  return token;
}

export async function authRequest(body, env, path = "/api/auth/login", ip = "") {
  // A unique IP per caller keeps the shared throttle from crossing tests.
  return new Request(`https://app.local${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(ip ? { "cf-connecting-ip": ip } : {}),
    },
    body: JSON.stringify(body),
  });
}
