import test from "node:test";
import assert from "node:assert/strict";

import { requireSession, sessionVersion } from "../functions/_lib/auth.js";
import { sha256Hex, parseCookies } from "../functions/_lib/common.js";
import { onRequestPost as registerOrLogin } from "../functions/api/auth/login.js";
import { onRequestPost as logout } from "../functions/api/auth/logout.js";

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
    entries: () => [...map.entries()],
  };
}

/**
 * Minimal D1 stand-in for the auth queries used by login.js and auth.js.
 * Any unexpected statement throws, so a test also proves that a legacy
 * `months` transfer did not run.
 */
function makeDB(users = new Map()) {
  const throttle = new Map();
  let pinLookups = 0;
  return {
    users,
    throttle,
    pinLookups: () => pinLookups,
    prepare(sql) {
      return {
        bind(...args) {
          return {
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
              if (/SELECT count, lock_until FROM auth_throttle WHERE key = \?/i.test(sql)) {
                const row = throttle.get(args[0]);
                return row ? { count: row.count, lock_until: row.lock_until } : null;
              }
              throw new Error(`unexpected first(): ${sql}`);
            },
            run: async () => {
              if (/INSERT INTO users/i.test(sql)) {
                const [id, salt, pin_hash, updated_at] = args;
                users.set(id, { salt, pin_hash, updated_at, created_at: updated_at });
                return { success: true };
              }
              if (/UPDATE users SET salt = \?, pin_hash = \?, updated_at = \? WHERE id = \?/i.test(sql)) {
                const [salt, pin_hash, updated_at, id] = args;
                const user = users.get(id);
                if (!user) return { success: false };
                users.set(id, { ...user, salt, pin_hash, updated_at });
                return { success: true };
              }
              if (/DELETE FROM months WHERE user_id = \?/i.test(sql)) {
                return { success: true };
              }
              if (/DELETE FROM users WHERE id = \?/i.test(sql)) {
                users.delete(args[0]);
                return { success: true };
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
                return { success: true };
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
                return { success: true };
              }
              if (/UPDATE auth_throttle SET count = MAX\(count - 1, 0\)/i.test(sql)) {
                const [key, now] = args;
                const row = throttle.get(key);
                if (row && row.lock_until <= now) row.count = Math.max(row.count - 1, 0);
                return { success: true };
              }
              if (/DELETE FROM auth_throttle WHERE key = \?/i.test(sql)) {
                throttle.delete(args[0]);
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

function addUser(users, id, pinHash, salt = "salt") {
  users.set(id, {
    salt,
    pin_hash: pinHash,
    created_at: 1,
    updated_at: 1,
  });
}

function sessionRequest(token, path = "/api/data") {
  return new Request(`https://app.local${path}`, {
    headers: token ? { cookie: `pf_session=${token}` } : {},
  });
}

async function seedSession(kv, userID, pinHash) {
  const token = `tok_${Math.random().toString(36).slice(2)}`;
  const ver = await sessionVersion(pinHash);
  await kv.put(`sess:${token}`, JSON.stringify({ userID, ver }));
  return token;
}

async function authRequest(body, env, path = "/api/auth/login") {
  return new Request(`https://app.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const OLD_HASH = "a".repeat(64);
const NEW_HASH = "b".repeat(64);

test("requireSession accepts a token whose account and verifier still match", async () => {
  const users = new Map();
  addUser(users, "alice", OLD_HASH);
  const kv = makeKV();
  const token = await seedSession(kv, "alice", OLD_HASH);

  const session = await requireSession({
    request: sessionRequest(token),
    env: { SESSIONS: kv, DB: makeDB(users) },
  });

  assert.equal(session.userID, "alice");
});

test("requireSession rejects a token after the account is deleted", async () => {
  const users = new Map();
  addUser(users, "alice", OLD_HASH);
  const kv = makeKV();
  const token = await seedSession(kv, "alice", OLD_HASH);

  users.delete("alice");

  const session = await requireSession({
    request: sessionRequest(token),
    env: { SESSIONS: kv, DB: makeDB(users) },
  });

  assert.equal(session, null);
});

test("requireSession rejects a token after the password changes", async () => {
  const users = new Map();
  addUser(users, "alice", OLD_HASH);
  const kv = makeKV();
  const token = await seedSession(kv, "alice", OLD_HASH);

  users.get("alice").pin_hash = NEW_HASH;

  const session = await requireSession({
    request: sessionRequest(token),
    env: { SESSIONS: kv, DB: makeDB(users) },
  });

  assert.equal(session, null);
});

test("requireSession rejects an old token after the username is re-registered", async () => {
  const users = new Map();
  addUser(users, "alice", OLD_HASH);
  const kv = makeKV();
  const token = await seedSession(kv, "alice", OLD_HASH);

  // Deletion plus a fresh registration always produces a new random salt, so
  // the verifier differs even when the same password is chosen again.
  users.delete("alice");
  addUser(users, "alice", NEW_HASH, "fresh-random-salt");

  const session = await requireSession({
    request: sessionRequest(token),
    env: { SESSIONS: kv, DB: makeDB(users) },
  });

  assert.equal(session, null);
});

test("requireSession rejects legacy session records that carry no version", async () => {
  const users = new Map();
  addUser(users, "alice", OLD_HASH);
  const kv = makeKV({ "sess:legacy": JSON.stringify({ userID: "alice" }) });

  const session = await requireSession({
    request: sessionRequest("legacy"),
    env: { SESSIONS: kv, DB: makeDB(users) },
  });

  assert.equal(session, null);
});

test("requireSession rejects a missing cookie", async () => {
  const session = await requireSession({
    request: sessionRequest(null),
    env: { SESSIONS: makeKV(), DB: makeDB() },
  });
  assert.equal(session, null);
});

test("parseCookies keeps going when one cookie has a malformed escape", () => {
  const request = new Request("https://app.local", {
    headers: { cookie: "bad=%E0%A4%A; pf_session=abc" },
  });

  assert.deepEqual(parseCookies(request), {
    bad: "%E0%A4%A",
    pf_session: "abc",
  });
});

for (const reserved of ["default", "admin", "root", "system", "__internal"]) {
  test(`registration refuses the reserved username ${reserved}`, async () => {
    const users = new Map();
    const env = { SESSIONS: makeKV(), DB: makeDB(users) };

    const response = await registerOrLogin({
      env,
      request: await authRequest(
        { mode: "register", username: reserved, password: "secret1", confirmPassword: "secret1" },
        env
      ),
    });

    assert.equal(response.status, 400);
    assert.equal(users.size, 0);
  });
}

test("registration mints a versioned session and never copies legacy months", async () => {
  const users = new Map();
  const kv = makeKV();
  const db = makeDB(users);

  const response = await registerOrLogin({
    env: { SESSIONS: kv, DB: db },
    request: await authRequest(
      { mode: "register", username: "alice", password: "secret1", confirmPassword: "secret1" },
      { SESSIONS: kv, DB: db }
    ),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.userID, "alice");

  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /pf_session=[a-f0-9]{48}/);

  const entries = kv.entries().filter(([key]) => key.startsWith("sess:"));
  assert.equal(entries.length, 1);
  const record = JSON.parse(entries[0][1]);
  assert.equal(record.userID, "alice");
  assert.equal(record.ver, await sessionVersion(users.get("alice").pin_hash));

  const session = await requireSession({
    request: sessionRequest(entries[0][0].slice("sess:".length)),
    env: { SESSIONS: kv, DB: db },
  });
  assert.equal(session.userID, "alice");
});

test("logout deletes the token and returns a clearing cookie", async () => {
  const kv = makeKV({ "sess:tok": JSON.stringify({ userID: "alice", ver: "x" }) });

  const response = await logout({
    env: { SESSIONS: kv },
    request: new Request("https://app.local/api/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "pf_session=tok" },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(await kv.get("sess:tok"), null);
  assert.match(response.headers.get("set-cookie"), /pf_session=;.*Max-Age=0/);
});

test("logout still returns a clearing cookie when the KV delete fails", async () => {
  const kv = makeKV();
  kv.delete = async () => {
    throw new Error("KV unavailable");
  };

  const response = await logout({
    env: { SESSIONS: kv },
    request: new Request("https://app.local/api/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "pf_session=tok" },
    }),
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /pf_session=;.*Max-Age=0/);
});

test("cross-site and non-JSON auth posts are rejected before any DB work", async () => {
  const users = new Map();
  addUser(users, "alice", await sha256Hex("salt:secret1"));
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };

  const crossSite = await registerOrLogin({
    env,
    request: new Request("https://app.local/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ mode: "login", username: "alice", password: "wrong1" }),
    }),
  });
  assert.equal(crossSite.status, 403);

  const formPost = await registerOrLogin({
    env,
    request: new Request("https://app.local/api/auth/login", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ mode: "login", username: "alice", password: "wrong1" }),
    }),
  });
  assert.equal(formPost.status, 415);

  assert.equal(db.pinLookups(), 0);
  assert.equal(db.throttle.size, 0);
});

test("a half-configured Turnstile deployment fails closed", async () => {
  const users = new Map();
  addUser(users, "alice", await sha256Hex("salt:secret1"));
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db, TURNSTILE_SITE_KEY: "site-key" };

  const response = await registerOrLogin({
    env,
    request: authPost({ mode: "login", username: "alice", password: "secret1" }, "203.0.113.20"),
  });

  assert.equal(response.status, 400);
  assert.equal(db.pinLookups(), 0);
});

test("changing the password revokes every earlier token and issues a working one", async () => {
  const users = new Map();
  const pinHash = await sha256Hex("salt:secret1");
  addUser(users, "alice", pinHash);
  const kv = makeKV();
  const db = makeDB(users);
  const oldToken = await seedSession(kv, "alice", pinHash);

  const oldSession = await requireSession({
    request: sessionRequest(oldToken),
    env: { SESSIONS: kv, DB: db },
  });
  assert.equal(oldSession.userID, "alice");

  const response = await registerOrLogin({
    env: { SESSIONS: kv, DB: db },
    request: new Request("https://app.local/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `pf_session=${oldToken}` },
      body: JSON.stringify({
        mode: "changepassword",
        currentPassword: "secret1",
        password: "secret2",
        confirmPassword: "secret2",
      }),
    }),
  });

  assert.equal(response.status, 200);

  const revoked = await requireSession({
    request: sessionRequest(oldToken),
    env: { SESSIONS: kv, DB: db },
  });
  assert.equal(revoked, null);

  const newCookie = response.headers.get("set-cookie");
  const newToken = /pf_session=([a-f0-9]{48})/.exec(newCookie)[1];
  const fresh = await requireSession({
    request: sessionRequest(newToken),
    env: { SESSIONS: kv, DB: db },
  });
  assert.equal(fresh.userID, "alice");
  assert.equal(fresh.ver, await sessionVersion(users.get("alice").pin_hash));
});

test("deleting the account revokes every earlier token", async () => {
  const users = new Map();
  const pinHash = await sha256Hex("salt:secret1");
  addUser(users, "alice", pinHash);
  const kv = makeKV();
  const db = makeDB(users);
  const token = await seedSession(kv, "alice", pinHash);

  const response = await registerOrLogin({
    env: { SESSIONS: kv, DB: db },
    request: new Request("https://app.local/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `pf_session=${token}` },
      body: JSON.stringify({ mode: "resetaccount", password: "secret1", resetConfirm: "DELETE" }),
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(users.has("alice"), false);

  const session = await requireSession({
    request: sessionRequest(token),
    env: { SESSIONS: kv, DB: db },
  });
  assert.equal(session, null);
});

function authPost(body, ip = "198.51.100.7", cookie = "") {
  return new Request("https://app.local/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": ip,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("a parallel wrong-password burst verifies at most five passwords", async () => {
  const users = new Map();
  addUser(users, "alice", await sha256Hex("salt:secret1"));
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };

  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      registerOrLogin({
        env,
        request: authPost({ mode: "login", username: "alice", password: "wrong1" }, "203.0.113.9"),
      })
    )
  );

  const statuses = responses.map((response) => response.status);
  assert.equal(statuses.filter((status) => status === 401).length + statuses.filter((status) => status === 429).length, 10);
  assert.ok(db.pinLookups() <= 5);
});

test("a successful login releases only its own slot, not the failure budget", async () => {
  const users = new Map();
  addUser(users, "alice", await sha256Hex("salt:secret1"));
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };
  const ip = "203.0.113.10";

  for (let i = 0; i < 4; i += 1) {
    const response = await registerOrLogin({
      env,
      request: authPost({ mode: "login", username: "alice", password: "wrong1" }, ip),
    });
    assert.equal(response.status, 401);
  }

  const success = await registerOrLogin({
    env,
    request: authPost({ mode: "login", username: "alice", password: "secret1" }, ip),
  });
  assert.equal(success.status, 200);

  const next = await registerOrLogin({
    env,
    request: authPost({ mode: "login", username: "alice", password: "wrong1" }, ip),
  });
  assert.equal(next.status, 401);

  const locked = await registerOrLogin({
    env,
    request: authPost({ mode: "login", username: "alice", password: "secret1" }, ip),
  });
  assert.equal(locked.status, 429);
  assert.match(locked.headers.get("Retry-After"), /^\d+$/);
});

test("successful registrations still accumulate in the IP rate bucket", async () => {
  const users = new Map();
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };
  const ip = "203.0.113.11";

  for (let i = 0; i < 30; i += 1) {
    const response = await registerOrLogin({
      env,
      request: authPost(
        {
          mode: "register",
          username: `user${i}`,
          password: "secret1",
          confirmPassword: "secret1",
        },
        ip
      ),
    });
    assert.equal(response.status, 200);
  }

  const rate = db.throttle.get(`authrate:ip:${ip}`);
  assert.equal(rate.count, 30);
  assert.equal(db.throttle.get(`authfail:ip:${ip}`).count, 0);

  const blocked = await registerOrLogin({
    env,
    request: authPost(
      {
        mode: "register",
        username: "user30",
        password: "secret1",
        confirmPassword: "secret1",
      },
      ip
    ),
  });
  assert.equal(blocked.status, 429);
});

test("four failures plus a registration do not reset the failure bucket", async () => {
  const users = new Map();
  addUser(users, "alice", await sha256Hex("salt:secret1"));
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };
  const ip = "203.0.113.14";

  for (let i = 0; i < 4; i += 1) {
    const response = await registerOrLogin({
      env,
      request: authPost({ mode: "login", username: "alice", password: "wrong1" }, ip),
    });
    assert.equal(response.status, 401);
  }

  const registration = await registerOrLogin({
    env,
    request: authPost(
      { mode: "register", username: "bob", password: "secret1", confirmPassword: "secret1" },
      ip
    ),
  });
  assert.equal(registration.status, 200);
  assert.equal(db.throttle.get(`authfail:ip:${ip}`).count, 4);

  const fifth = await registerOrLogin({
    env,
    request: authPost({ mode: "login", username: "alice", password: "wrong1" }, ip),
  });
  assert.equal(fifth.status, 401);

  const sixth = await registerOrLogin({
    env,
    request: authPost({ mode: "login", username: "alice", password: "wrong1" }, ip),
  });
  assert.equal(sixth.status, 429);
});

test("an unknown username never creates a username lock", async () => {
  const users = new Map();
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };
  const ip = "203.0.113.12";

  for (let i = 0; i < 6; i += 1) {
    await registerOrLogin({
      env,
      request: authPost({ mode: "login", username: "ghost", password: "wrong1" }, ip),
    });
  }

  assert.equal([...db.throttle.keys()].some((key) => key.startsWith("authfail:user:")), false);
});

test("wrong current-password guesses are throttled like a login", async () => {
  const users = new Map();
  const pinHash = await sha256Hex("salt:secret1");
  addUser(users, "alice", pinHash);
  const kv = makeKV();
  const db = makeDB(users);
  const env = { SESSIONS: kv, DB: db };
  const token = await seedSession(kv, "alice", pinHash);
  const ip = "203.0.113.13";

  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    const response = await registerOrLogin({
      env,
      request: authPost(
        {
          mode: "changepassword",
          currentPassword: "wrong1",
          password: "secret2",
          confirmPassword: "secret2",
        },
        ip,
        `pf_session=${token}`
      ),
    });
    statuses.push(response.status);
  }

  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);

  const locked = await registerOrLogin({
    env,
    request: authPost(
      {
        mode: "changepassword",
        currentPassword: "secret1",
        password: "secret2",
        confirmPassword: "secret2",
      },
      ip,
      `pf_session=${token}`
    ),
  });
  assert.equal(locked.status, 429);
});
