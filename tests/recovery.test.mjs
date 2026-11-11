import test from "node:test";
import assert from "node:assert/strict";

import { hashPassword, verifyPassword } from "../functions/_lib/common.js";
import {
  RECOVERY_CODE_COUNT,
  buildRecoveryCodeRows,
  formatRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  isValidRecoveryCode,
  matchesRecoveryCode,
  normalizeRecoveryCode,
} from "../functions/_lib/recovery.js";
import { onRequestPost as auth } from "../functions/api/auth/login.js";
import {
  onRequestGet as recoveryStatus,
  onRequestPost as rotateRecoveryCodes,
} from "../functions/api/auth/recovery-codes.js";
import { makeKV, makeDB } from "./helpers/auth-fakes.mjs";

let ipSeq = 0;
/** A fresh IP per request keeps the shared throttle out of these tests. */
function nextIP() {
  ipSeq += 1;
  return `192.0.2.${ipSeq}`;
}

async function post(body, env, path = "/api/auth/login", cookie = "", ip = nextIP()) {
  return auth({
    request: new Request(`https://app.local${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": ip,
        ...(cookie ? { cookie: `pf_session=${cookie}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    env,
  });
}

async function get(path, env, cookie = "") {
  const request = new Request(`https://app.local${path}`, {
    headers: {
      "cf-connecting-ip": nextIP(),
      ...(cookie ? { cookie: `pf_session=${cookie}` } : {}),
    },
  });
  return recoveryStatus({ request, env });
}

async function rotate(body, env, cookie = "") {
  return rotateRecoveryCodes({
    request: new Request("https://app.local/api/auth/recovery-codes", {
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
  const body = await response.json();
  return { response, body, token: tokenFrom(response) };
}

test("generates ten unique, formatted codes from the unambiguous alphabet", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, RECOVERY_CODE_COUNT);
  assert.equal(new Set(codes).size, RECOVERY_CODE_COUNT);
  for (const code of codes) {
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.ok(isValidRecoveryCode(code));
  }
});

test("normalizes case, spaces and missing separators", () => {
  assert.equal(normalizeRecoveryCode(" abcd-efgh-jkmn "), "ABCDEFGHJKMN");
  assert.equal(normalizeRecoveryCode("ABCD EFGH JKMN"), "ABCDEFGHJKMN");
  assert.equal(formatRecoveryCode("abcdefghjkmn"), "ABCD-EFGH-JKMN");
  assert.equal(formatRecoveryCode("ABCD-EFGH-JKMN"), "ABCD-EFGH-JKMN");
});

test("rejects codes of the wrong length or with excluded letters", () => {
  assert.equal(isValidRecoveryCode("ABCD-EFGH-JKMN"), true);
  assert.equal(isValidRecoveryCode("ABCD-EFGH-JKM"), false);
  assert.equal(isValidRecoveryCode("ABCD-EFGH-JKMNO"), false);
  // I, O, 0 and 1 are deliberately not in the alphabet.
  assert.equal(isValidRecoveryCode("ABCD-EFGH-JKMI"), false);
  assert.equal(isValidRecoveryCode("ABCD-EFGH-JKM0"), false);
  assert.equal(isValidRecoveryCode(""), false);
});

test("stores only salted hashes, never the plaintext code", async () => {
  const codes = generateRecoveryCodes(3);
  const rows = await buildRecoveryCodeRows("alice", codes);

  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((row) => row.salt)).size, 3);
  assert.equal(new Set(rows.map((row) => row.id)).size, 3);

  for (const row of rows) {
    assert.equal(row.userID, "alice");
    assert.match(row.codeHash, /^[a-f0-9]{64}$/);
    for (const code of codes) {
      assert.notEqual(row.codeHash, code);
      assert.notEqual(row.codeHash, normalizeRecoveryCode(code));
    }
  }
});

test("a hash only matches its own code and salt", async () => {
  const [code] = generateRecoveryCodes(1);
  const row = {
    salt: "fixed-salt",
    code_hash: await hashRecoveryCode(code, "fixed-salt"),
  };

  assert.equal(await matchesRecoveryCode(code, row), true);
  assert.equal(await matchesRecoveryCode(code.toLowerCase(), row), true);
  assert.equal(await matchesRecoveryCode("AAAA-BBBB-CCCC", row), false);
  assert.equal(await matchesRecoveryCode(code, { salt: "other-salt", code_hash: row.code_hash }), false);
  assert.equal(await matchesRecoveryCode(code, {}), false);
});

test("registration returns ten codes and stores ten hashes", async () => {
  const users = new Map();
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };

  const { response, body } = await register(env);

  assert.equal(response.status, 200);
  assert.equal(body.authenticated, true);
  assert.equal(body.recoveryCodes.length, RECOVERY_CODE_COUNT);
  assert.equal(db.recoveryCodes.size, RECOVERY_CODE_COUNT);

  const stored = [...db.recoveryCodes.values()];
  for (const code of body.recoveryCodes) {
    const normalized = normalizeRecoveryCode(code);
    assert.ok(!stored.some((row) => row.code_hash === normalized));
    assert.ok(stored.every((row) => !row.code_hash.includes(normalized)));
  }
});

test("a valid code resets the password, burns the code and issues no session", async () => {
  const users = new Map();
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };

  const { body: registered } = await register(env, "alice", "secret1");
  const code = registered.recoveryCodes[0];

  const response = await post(
    {
      mode: "recover",
      username: "alice",
      code,
      password: "brand-new-1",
      confirmPassword: "brand-new-1",
    },
    env
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.recovered, true);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(body.recoveryCodes, undefined);

  assert.equal((await verifyPassword("brand-new-1", users.get("alice"), env)).ok, true);
  assert.equal((await verifyPassword("secret1", users.get("alice"), env)).ok, false);

  const used = [...db.recoveryCodes.values()].filter((row) => row.used_at !== null);
  assert.equal(used.length, 1);

  // The same code cannot be spent twice.
  const replay = await post(
    {
      mode: "recover",
      username: "alice",
      code,
      password: "another-one",
      confirmPassword: "another-one",
    },
    env
  );
  assert.equal(replay.status, 401);
});

test("a wrong code fails without changing the password or burning a code", async () => {
  const users = new Map();
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };

  const { body: registered } = await register(env, "bob", "secret1");
  const good = registered.recoveryCodes[0];
  const bad = `${good.slice(0, -1)}${good.endsWith("A") ? "B" : "A"}`;
  const before = users.get("bob").pin_hash;

  const response = await post(
    { mode: "recover", username: "bob", code: bad, password: "newsecret", confirmPassword: "newsecret" },
    env
  );

  assert.equal(response.status, 401);
  assert.equal(users.get("bob").pin_hash, before);
  assert.ok([...db.recoveryCodes.values()].every((row) => row.used_at === null));

  // The untouched code still works.
  const retry = await post(
    { mode: "recover", username: "bob", code: good, password: "newsecret", confirmPassword: "newsecret" },
    env
  );
  assert.equal(retry.status, 200);
});

test("recovery rejects an unknown user, a bad shape and a mismatched confirmation", async () => {
  const env = { SESSIONS: makeKV(), DB: makeDB(new Map()) };

  const unknown = await post(
    { mode: "recover", username: "nobody", code: "ABCD-EFGH-JKMN", password: "newsecret", confirmPassword: "newsecret" },
    env
  );
  assert.equal(unknown.status, 401);

  const wrongShape = await post(
    { mode: "recover", username: "nobody", code: "nope", password: "newsecret", confirmPassword: "newsecret" },
    env
  );
  assert.equal(wrongShape.status, 400);

  const mismatch = await post(
    { mode: "recover", username: "nobody", code: "ABCD-EFGH-JKMN", password: "newsecret", confirmPassword: "other" },
    env
  );
  assert.equal(mismatch.status, 400);
});

test("re-registering a username never inherits the old recovery codes", async () => {
  const users = new Map();
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };

  const { body: first } = await register(env, "carol", "secret1");
  const oldCode = first.recoveryCodes[0];

  // Simulate a freed username whose recovery rows were left behind.
  users.delete("carol");

  const { body: second } = await register(env, "carol", "secret2");
  assert.equal(second.recoveryCodes.length, RECOVERY_CODE_COUNT);
  assert.equal(db.recoveryCodes.size, RECOVERY_CODE_COUNT);

  const attempt = await post(
    { mode: "recover", username: "carol", code: oldCode, password: "hijacked", confirmPassword: "hijacked" },
    env
  );
  assert.equal(attempt.status, 401);
  assert.equal((await verifyPassword("secret2", users.get("carol"), env)).ok, true);
});

test("deleting an account removes its recovery codes", async () => {
  const users = new Map();
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };

  const { token } = await register(env, "dave", "secret1");
  assert.equal(db.recoveryCodes.size, RECOVERY_CODE_COUNT);

  const response = await post(
    { mode: "resetaccount", password: "secret1", resetConfirm: "DELETE" },
    env,
    "/api/auth/login",
    token
  );
  assert.equal(response.status, 200);
  assert.equal(users.has("dave"), false);
  assert.equal(db.recoveryCodes.size, 0);
});

test("rotating codes requires the current password and replaces the whole set", async () => {
  const users = new Map();
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };

  const { body: registered, token } = await register(env, "erin", "secret1");
  const oldCode = registered.recoveryCodes[0];

  const wrong = await rotate({ password: "not-the-password" }, env, token);
  assert.equal(wrong.status, 401);
  assert.equal(db.recoveryCodes.size, RECOVERY_CODE_COUNT);

  const ok = await rotate({ password: "secret1" }, env, token);
  const body = await ok.json();
  assert.equal(ok.status, 200);
  assert.equal(body.recoveryCodes.length, RECOVERY_CODE_COUNT);
  assert.equal(db.recoveryCodes.size, RECOVERY_CODE_COUNT);

  // Nothing from the old set survives.
  const old = await post(
    { mode: "recover", username: "erin", code: oldCode, password: "stolen1", confirmPassword: "stolen1" },
    env
  );
  assert.equal(old.status, 401);

  const fresh = await post(
    { mode: "recover", username: "erin", code: body.recoveryCodes[0], password: "chosen1", confirmPassword: "chosen1" },
    env
  );
  assert.equal(fresh.status, 200);
});

test("exposing the code count needs a session but never returns the codes", async () => {
  const users = new Map();
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };

  const { token } = await register(env, "frank", "secret1");

  const anonymous = await get("/api/auth/recovery-codes", env);
  assert.equal(anonymous.status, 401);

  const status = await get("/api/auth/recovery-codes", env, token);
  const body = await status.json();
  assert.deepEqual(body, { ok: true, total: RECOVERY_CODE_COUNT, remaining: RECOVERY_CODE_COUNT });
  assert.equal(JSON.stringify(body).includes("-"), false);
});

test("a used code reduces the remaining count", async () => {
  const users = new Map();
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };

  const { body: registered } = await register(env, "grace", "secret1");

  await post(
    {
      mode: "recover",
      username: "grace",
      code: registered.recoveryCodes[3],
      password: "changed1",
      confirmPassword: "changed1",
    },
    env
  );

  const login = await post({ mode: "login", username: "grace", password: "changed1" }, env);
  const token = tokenFrom(login);

  const status = await get("/api/auth/recovery-codes", env, token);
  const body = await status.json();
  assert.equal(body.total, RECOVERY_CODE_COUNT);
  assert.equal(body.remaining, RECOVERY_CODE_COUNT - 1);
});

test("registration still succeeds when recovery codes cannot be written", async () => {
  const users = new Map();
  const db = makeDB(users);
  // The table is missing on a deployment that has not run migration 0003.
  db.batch = async () => {
    throw new Error("no such table: recovery_codes");
  };
  const env = { SESSIONS: makeKV(), DB: db };

  const { response, body } = await register(env, "heidi", "secret1");

  assert.equal(response.status, 200);
  assert.equal(body.authenticated, true);
  assert.equal(body.recoveryCodes, undefined);
  assert.equal((await verifyPassword("secret1", users.get("heidi"), env)).ok, true);
});

test("a login lockout does not close the recovery path", async () => {
  const users = new Map();
  const db = makeDB(users);
  const env = { SESSIONS: makeKV(), DB: db };

  const { body: registered } = await register(env, "ivan", "secret1");
  const code = registered.recoveryCodes[0];
  const ip = "198.51.100.9";

  for (let i = 0; i < 6; i += 1) {
    await post({ mode: "login", username: "ivan", password: "wrong-password" }, env, "/api/auth/login", "", ip);
  }

  const locked = await post({ mode: "login", username: "ivan", password: "secret1" }, env, "/api/auth/login", "", ip);
  assert.equal(locked.status, 429);

  // The same IP can still redeem a code, because recovery has its own bucket.
  const recovered = await post(
    { mode: "recover", username: "ivan", code, password: "recovered1", confirmPassword: "recovered1" },
    env,
    "/api/auth/login",
    "",
    ip
  );
  assert.equal(recovered.status, 200);
});

test("a hashPassword verifier and its recovery codes are independent secrets", async () => {
  const env = {};
  const { salt, pinHash } = await hashPassword("secret1", env);
  const user = { salt, pin_hash: pinHash };
  const [code] = generateRecoveryCodes(1);
  const row = { salt: "row-salt", code_hash: await hashRecoveryCode(code, "row-salt") };

  assert.equal((await verifyPassword("secret1", user, env)).ok, true);
  assert.equal(await matchesRecoveryCode(code, row), true);
  assert.equal(await matchesRecoveryCode("secret1", row), false);
});
