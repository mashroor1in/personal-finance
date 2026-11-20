/**
 * End-to-end tests for the waitlist HTTP handlers.
 *
 * The handlers run unmodified against Node's built-in SQLite, behind a small
 * shim that implements the subset of the D1 API they actually use
 * (`prepare().bind().first()/all()/run()`). Cloudflare is replaced by a stub
 * `fetch`, so both the Turnstile exchange and the mailer are observable.
 *
 * Everything asserted here is a behaviour a user or an attacker could trigger:
 * duplicate signups, forged bot tokens, wrong verification tokens, reused
 * links, and the throttle.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { onRequestPost, onRequestGet } from "../functions/early-access/api/waitlist/index.js";
import {
  onRequestGet as verifyGet,
  onRequestPost as verifyPost,
} from "../functions/early-access/api/verify/index.js";
import { onRequestGet as referralGet } from "../functions/early-access/api/referral/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, "..", "migrations", name), "utf8");

const WAITLIST_SQL = read("0006_waitlist.sql");
const ADDENDUM_SQL = read("0007_waitlist_verification_sent_at.sql");
const THROTTLE_SQL = read("0002_auth_throttle.sql");

/* ------------------------------------------------------------ D1 shim -- */

function d1Shim(db) {
  function statement(sql) {
    const build = (args) => ({
      bind: (...more) => build([...args, ...more]),
      first: async () => {
        const row = db.prepare(sql).get(...args);
        return row === undefined ? null : row;
      },
      all: async () => ({ results: db.prepare(sql).all(...args) }),
      run: async () => {
        const info = db.prepare(sql).run(...args);
        return { success: true, meta: { changes: info.changes } };
      },
    });
    return build([]);
  }
  return { prepare: statement, batch: async (stmts) => Promise.all(stmts) };
}

/* -------------------------------------------------------- request shim -- */

function request({ method = "POST", path = "/early-access/api/waitlist", body, headers = {} }) {
  const map = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return {
    method,
    url: `https://bucksy.life${path}`,
    headers: { get: (key) => map.get(String(key).toLowerCase()) ?? null },
    json: async () => {
      if (body === undefined) throw new Error("empty body");
      return typeof body === "string" ? JSON.parse(body) : body;
    },
  };
}

const JSON_HEADERS = { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" };

/* -------------------------------------------------------------- harness -- */

function harness({ turnstileSucceeds = true } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(WAITLIST_SQL);
  db.exec(ADDENDUM_SQL);
  db.exec(THROTTLE_SQL);

  const mail = [];
  const siteverify = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("siteverify")) {
      siteverify.push({ url, body: String(init?.body || "") });
      return { ok: true, json: async () => ({ success: turnstileSucceeds }) };
    }
    if (String(url).includes("mailer.test")) {
      mail.push(JSON.parse(String(init?.body || "{}")));
      return { ok: true, json: async () => ({ ok: true }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const env = {
    DB: d1Shim(db),
    TURNSTILE_SITE_KEY: "site-key",
    TURNSTILE_SECRET: "secret-key",
    WAITLIST_EMAIL_ENDPOINT: "https://mailer.test/send",
    WAITLIST_ADMIN_TOKEN: "admin-token",
  };

  return {
    db,
    env,
    mail,
    siteverify,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
    count: () => db.prepare("SELECT COUNT(*) AS c FROM waitlist").get().c,
    row: (email) => db.prepare("SELECT * FROM waitlist WHERE email = ?").get(email),
    lastMailToken: () => {
      const link = mail[mail.length - 1].link;
      return new URL(link).searchParams.get("token");
    },
  };
}

async function withHarness(options, fn) {
  const h = harness(options);
  try {
    return await fn(h);
  } finally {
    h.restore();
  }
}

function signup(h, body, headers = JSON_HEADERS) {
  return onRequestPost({
    request: request({ method: "POST", body, headers }),
    env: h.env,
  });
}

/* ------------------------------------------------------------- signup -- */

test("a valid signup creates one pending row and emails a link", () =>
  withHarness({}, async (h) => {
    const res = await signup(h, {
      email: "  Ada@Example.COM ",
      turnstileToken: "a-real-turnstile-token",
    });
    assert.equal(res.status, 201);

    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, "pending");
    assert.match(body.referralCode, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);

    const row = h.row("ada@example.com");
    assert.equal(row.status, "pending");
    assert.equal(row.email_verified, 0);
    assert.equal(h.count(), 1, "stored address is normalised, not duplicated");

    // Only a hash is persisted, and it is not the token.
    assert.match(row.verification_token_hash, /^[0-9a-f]{64}$/);
    const token = h.lastMailToken();
    assert.notEqual(row.verification_token_hash, token);

    assert.equal(h.mail.length, 1);
    assert.equal(h.mail[0].to, "ada@example.com");
  }));

test("the Turnstile token is exchanged with Cloudflare, not trusted locally", () =>
  withHarness({}, async (h) => {
    await signup(h, { email: "ada@example.com", turnstileToken: "token-from-widget" });
    assert.equal(h.siteverify.length, 1);
    assert.match(h.siteverify[0].body, /response=token-from-widget/);
  }));

test("a forged token is refused and writes nothing", () =>
  withHarness({ turnstileSucceeds: false }, async (h) => {
    const res = await signup(h, {
      email: "ada@example.com",
      turnstileToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    assert.equal(res.status, 403);
    assert.equal(h.count(), 0);
  }));

test("a missing token is refused", () =>
  withHarness({}, async (h) => {
    const res = await signup(h, { email: "ada@example.com" });
    assert.equal(res.status, 403);
    assert.equal(h.count(), 0);
  }));

test("disposable and role addresses are refused", () =>
  withHarness({}, async (h) => {
    const disposable = await signup(h, {
      email: "x@mailinator.com",
      turnstileToken: "t",
    });
    assert.equal(disposable.status, 400);
    assert.equal((await disposable.json()).code, "EMAIL_DISPOSABLE");

    const role = await signup(h, {
      email: "support@example.com",
      turnstileToken: "t",
    });
    assert.equal(role.status, 400);
    assert.equal((await role.json()).code, "EMAIL_ROLE");

    assert.equal(h.count(), 0);
  }));

test("signing up twice while pending re-sends instead of duplicating", () =>
  withHarness({}, async (h) => {
    await signup(h, { email: "ada@example.com", turnstileToken: "t" });
    const firstHash = h.row("ada@example.com").verification_token_hash;

    await new Promise((r) => setTimeout(r, 2));
    const again = await signup(h, { email: "ADA@example.com", turnstileToken: "t" });

    assert.equal(again.status, 202);
    assert.equal(h.count(), 1, "still one row");
    assert.notEqual(
      h.row("ada@example.com").verification_token_hash,
      firstHash,
      "the old link is invalidated"
    );
    assert.equal(h.mail.length, 2);
  }));

test("a verified address cannot register again", () =>
  withHarness({}, async (h) => {
    await signup(h, { email: "ada@example.com", turnstileToken: "t" });
    h.db.prepare("UPDATE waitlist SET status = 'verified' WHERE email = ?").run("ada@example.com");

    const res = await signup(h, { email: "ada@example.com", turnstileToken: "t" });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, "ALREADY_REGISTERED");
  }));

test("a cross-site or non-JSON body is rejected before anything else", () =>
  withHarness({}, async (h) => {
    const wrongType = await signup(
      h,
      { email: "ada@example.com", turnstileToken: "t" },
      { "content-type": "text/plain", "cf-connecting-ip": "203.0.113.7" }
    );
    assert.equal(wrongType.status, 415);

    const crossSite = await signup(
      h,
      { email: "ada@example.com", turnstileToken: "t" },
      { ...JSON_HEADERS, origin: "https://evil.example" }
    );
    assert.equal(crossSite.status, 403);

    assert.equal(h.count(), 0);
  }));

/* ------------------------------------------------------------ throttle -- */

test("repeated failures are throttled per IP", () =>
  withHarness({ turnstileSucceeds: false }, async (h) => {
    const statuses = [];
    for (let i = 0; i < 7; i += 1) {
      const res = await signup(h, { email: "ada@example.com", turnstileToken: "bad" });
      statuses.push(res.status);
    }

    // Calls 1..5 are refused by Turnstile; from then on the IP is locked out.
    assert.deepEqual(statuses.slice(0, 5), [403, 403, 403, 403, 403]);
    assert.equal(statuses[5], 429, `expected lockout, got ${statuses.join(",")}`);

    const locked = await signup(h, { email: "ada@example.com", turnstileToken: "bad" });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("retry-after")) > 0);
  }));

test("a different IP is not affected by another IP's lockout", () =>
  withHarness({ turnstileSucceeds: false }, async (h) => {
    for (let i = 0; i < 6; i += 1) {
      await signup(h, { email: "a@example.com", turnstileToken: "bad" });
    }
    const other = await signup(
      h,
      { email: "b@example.com", turnstileToken: "bad" },
      { ...JSON_HEADERS, "cf-connecting-ip": "198.51.100.4" }
    );
    assert.equal(other.status, 403, "refused by Turnstile, not by the other IP's lock");
  }));

/* ------------------------------------------------------ verification -- */

test("a valid link verifies the address and burns the token", () =>
  withHarness({}, async (h) => {
    await signup(h, { email: "ada@example.com", turnstileToken: "t" });
    const token = h.lastMailToken();

    const res = await verifyGet({
      request: request({
        method: "GET",
        path: `/early-access/api/verify?email=ada%40example.com&token=${token}`,
        headers: { "cf-connecting-ip": "203.0.113.7" },
      }),
      env: h.env,
    });

    assert.equal(res.status, 200);

    const row = h.row("ada@example.com");
    assert.equal(row.status, "verified");
    assert.equal(row.email_verified, 1);
    assert.equal(row.verification_token_hash, null, "the link cannot be replayed");
    assert.ok(row.verified_at > 0);
  }));

test("a wrong token is refused and leaves the row untouched", () =>
  withHarness({}, async (h) => {
    await signup(h, { email: "ada@example.com", turnstileToken: "t" });

    const res = await verifyGet({
      request: request({
        method: "GET",
        path: "/early-access/api/verify?email=ada%40example.com&token=deadbeef",
        headers: { "cf-connecting-ip": "203.0.113.7" },
      }),
      env: h.env,
    });

    assert.equal(res.status, 400);
    assert.equal(h.row("ada@example.com").status, "pending");
  }));

test("a token issued for one address cannot verify another", () =>
  withHarness({}, async (h) => {
    await signup(h, { email: "ada@example.com", turnstileToken: "t" });
    const token = h.lastMailToken();

    // Eve signs up and tries Ada's token.
    await signup(h, { email: "eve@example.com", turnstileToken: "t" });

    const res = await verifyGet({
      request: request({
        method: "GET",
        path: `/early-access/api/verify?email=eve%40example.com&token=${token}`,
        headers: { "cf-connecting-ip": "203.0.113.7" },
      }),
      env: h.env,
    });

    assert.equal(res.status, 400);
    assert.equal(h.row("eve@example.com").status, "pending");
  }));

test("an expired link is refused with a way forward", () =>
  withHarness({}, async (h) => {
    await signup(h, { email: "ada@example.com", turnstileToken: "t" });
    const token = h.lastMailToken();

    // Age the row past the 24h window.
    const now = Date.now();
    const agedTime = now - 25 * 60 * 60 * 1000;
    h.db
      .prepare("UPDATE waitlist SET created_at = ?, verification_sent_at = ? WHERE email = ?")
      .run(agedTime, agedTime, "ada@example.com");

    const row = h.row("ada@example.com");
    console.log("created_at:", row.created_at, "verification_sent_at:", row.verification_sent_at);

    const res = await verifyGet({
      request: request({
        method: "GET",
        path: `/early-access/api/verify?email=ada%40example.com&token=${token}`,
        headers: { "cf-connecting-ip": "203.0.113.7" },
      }),
      env: h.env,
    });

    assert.equal(res.status, 410);
    assert.equal(h.row("ada@example.com").status, "pending");
  }));

test("resend answers identically for known and unknown addresses", () =>
  withHarness({}, async (h) => {
    await signup(h, { email: "ada@example.com", turnstileToken: "t" });

    const known = await verifyPost({
      request: request({
        method: "POST",
        body: { email: "ada@example.com" },
        headers: { ...JSON_HEADERS, path: "/early-access/api/verify" },
      }),
      env: h.env,
    });
    const unknown = await verifyPost({
      request: request({
        method: "POST",
        body: { email: "nobody@example.com" },
        headers: { ...JSON_HEADERS, "cf-connecting-ip": "198.51.100.9" },
      }),
      env: h.env,
    });

    assert.equal(known.status, 202);
    assert.equal(unknown.status, 202);
    assert.deepEqual(await known.json(), await unknown.json());
  }));

/* -------------------------------------------------------------- status -- */

test("status reports registered true/false without leaking details", () =>
  withHarness({}, async (h) => {
    await signup(h, { email: "ada@example.com", turnstileToken: "t" });

    const found = await onRequestGet({
      request: request({
        method: "GET",
        path: "/early-access/api/waitlist?email=Ada%40Example.com",
        headers: { "cf-connecting-ip": "203.0.113.7" },
      }),
      env: h.env,
    });
    const foundBody = await found.json();
    assert.equal(foundBody.registered, true);
    assert.equal(foundBody.status, "pending");
    assert.equal("email" in foundBody, false, "the address is not echoed back");

    const missing = await onRequestGet({
      request: request({
        method: "GET",
        path: "/early-access/api/waitlist?email=nobody@example.com",
        headers: { "cf-connecting-ip": "198.51.100.2" },
      }),
      env: h.env,
    });
    assert.equal((await missing.json()).registered, false);
  }));

/* ------------------------------------------------------------ referral -- */

test("referral lookup returns counts and a masked address", () =>
  withHarness({}, async (h) => {
    const created = await signup(h, { email: "ada@example.com", turnstileToken: "t" });
    const { referralCode } = await created.json();

    const res = await referralGet({
      request: request({
        method: "GET",
        path: `/early-access/api/referral?code=${referralCode}`,
        headers: { "cf-connecting-ip": "203.0.113.7" },
      }),
      env: h.env,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.referrer.email, "a**@example.com");
    assert.equal(body.referrer.email.includes("ada"), false);
    assert.deepEqual(body.stats, { referrals: 0, verified: 0 });
  }));

test("the referral code is credited to the referrer", () =>
  withHarness({}, async (h) => {
    const created = await signup(h, { email: "ada@example.com", turnstileToken: "t" });
    const { referralCode } = await created.json();

    await signup(h, {
      email: "bob@example.com",
      turnstileToken: "t",
      referralCode,
    });

    const referrer = h.row("ada@example.com");
    const bob = h.row("bob@example.com");
    assert.equal(bob.referred_by, referrer.id);
  }));

test("an unknown referral code does not block the signup", () =>
  withHarness({}, async (h) => {
    const res = await signup(h, {
      email: "bob@example.com",
      turnstileToken: "t",
      referralCode: "ZZZZZZZZ",
    });
    assert.equal(res.status, 201);
    assert.equal(h.row("bob@example.com").referred_by, null);
  }));
