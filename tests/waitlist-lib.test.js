/**
 * Unit tests for the waitlist security primitives.
 *
 * These assert the properties the endpoints rely on, not the handlers'
 * plumbing: normalisation, what counts as an acceptable address, token hashing
 * being bound to the address, and Turnstile being verified *server-side*.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EVENT,
  normalizeEmail,
  isValidEmail,
  isDisposableEmail,
  isRoleAddress,
  validateSignup,
  hashVerificationToken,
  generateVerificationToken,
  generateReferralCode,
  maskEmail,
} from "../functions/_lib/waitlist.js";

import { verifyTurnstile } from "../functions/_lib/turnstile.js";

/* ---------------------------------------------------------------- email -- */

test("normalizeEmail trims and lowercases", () => {
  assert.equal(normalizeEmail("  Ada@Example.COM "), "ada@example.com");
  assert.equal(normalizeEmail(null), "");
  assert.equal(normalizeEmail(undefined), "");
});

test("isValidEmail accepts ordinary addresses", () => {
  for (const address of [
    "ada@example.com",
    "first.last+tag@sub.example.co.uk",
    "a@b.co",
  ]) {
    assert.equal(isValidEmail(address), true, address);
  }
});

test("isValidEmail rejects malformed addresses", () => {
  for (const address of [
    "",
    "no-at-sign",
    "@example.com",
    "ada@",
    "ada@example",
    "ada@@example.com",
    "ada@exam ple.com",
    "ada..lovelace@example.com",
    `${"a".repeat(250)}@example.com`,
  ]) {
    assert.equal(isValidEmail(address), false, address);
  }
});

test("disposable domains are detected, including subdomains", () => {
  assert.equal(isDisposableEmail("throwaway@mailinator.com"), true);
  assert.equal(isDisposableEmail("someone@inbox.mailinator.com"), true);
  assert.equal(isDisposableEmail("ada@example.com"), false);
});

test("role inboxes are detected", () => {
  assert.equal(isRoleAddress("support@example.com"), true);
  assert.equal(isRoleAddress("NO-REPLY@example.com"), true);
  assert.equal(isRoleAddress("ada@example.com"), false);
});

/* ---------------------------------------------------------- validation -- */

test("validateSignup returns a normalised value for good input", () => {
  const result = validateSignup({
    email: "  Ada@Example.com ",
    name: "  Ada Lovelace  ",
    country: "gb",
    referralCode: "abcd2345",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    email: "ada@example.com",
    name: "Ada Lovelace",
    country: "GB",
    referralCode: "ABCD2345",
  });
});

test("validateSignup omits empty optional fields rather than storing blanks", () => {
  const result = validateSignup({ email: "ada@example.com", name: "   ", country: "" });
  assert.equal(result.ok, true);
  assert.equal(result.value.name, null);
  assert.equal(result.value.country, null);
  assert.equal(result.value.referralCode, null);
});

test("validateSignup rejects bad input with a code and never echoes the value", () => {
  const cases = [
    [{}, "EMAIL_REQUIRED"],
    [{ email: "nope" }, "EMAIL_INVALID"],
    [{ email: "a@mailinator.com" }, "EMAIL_DISPOSABLE"],
    [{ email: "support@example.com" }, "EMAIL_ROLE"],
    [{ email: "ada@example.com", name: "x".repeat(81) }, "NAME_TOO_LONG"],
    [{ email: "ada@example.com", country: "GBR" }, "COUNTRY_INVALID"],
    [{ email: "ada@example.com", referralCode: "no spaces!" }, "REFERRAL_INVALID"],
  ];

  for (const [input, code] of cases) {
    const result = validateSignup(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.code, code, JSON.stringify(input));
    assert.equal(typeof result.error, "string");
  }
});

/* -------------------------------------------------------------- tokens -- */

test("verification tokens are long, random, and not reused", () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) {
    const token = generateVerificationToken();
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal(seen.has(token), false, "token repeated");
    seen.add(token);
  }
});

test("token hashing is deterministic and never returns the raw token", async () => {
  const token = generateVerificationToken();
  const a = await hashVerificationToken("ada@example.com", token);
  const b = await hashVerificationToken("ada@example.com", token);

  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, token);
});

test("token hash is bound to the address it was issued for", async () => {
  const token = generateVerificationToken();
  const forAda = await hashVerificationToken("ada@example.com", token);
  const forEve = await hashVerificationToken("eve@example.com", token);

  assert.notEqual(forAda, forEve, "a leaked hash must not work for another address");
});

test("token hashing normalises the address first", async () => {
  const token = generateVerificationToken();
  const lower = await hashVerificationToken("ada@example.com", token);
  const mixed = await hashVerificationToken("  ADA@Example.com ", token);
  assert.equal(lower, mixed);
});

/* ------------------------------------------------------------ referral -- */

test("referral codes are 8 unambiguous characters", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = generateReferralCode();
    assert.equal(code.length, 8);
    assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
  }
});

test("referral codes do not collide in practice", () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const code = generateReferralCode();
    assert.equal(seen.has(code), false, `collision after ${seen.size} codes`);
    seen.add(code);
  }
});

/* --------------------------------------------------------------- masks -- */

test("maskEmail hides the local part but keeps the domain", () => {
  assert.equal(maskEmail("ada@example.com"), "a**@example.com");
  assert.equal(maskEmail("a@example.com"), "a**@example.com");
  assert.equal(maskEmail("not-an-email"), "***");
  assert.equal(maskEmail(""), "***");
});

test("maskEmail never leaks the full local part", () => {
  const masked = maskEmail("verylonglocalpart@example.com");
  assert.equal(masked.includes("verylonglocalpart"), false);
});

/* ------------------------------------------------------------- events -- */

test("event vocabulary is lowercase snake_case", () => {
  for (const value of Object.values(EVENT)) {
    assert.match(value, /^[a-z][a-z0-9_]*$/, value);
  }
});

/* ----------------------------------------------------------- turnstile -- */

function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("turnstile passes when the feature is unconfigured", async () => {
  assert.equal(await verifyTurnstile({}), true);
  assert.equal(await verifyTurnstile({ secret: "", siteKey: "" }), true);
});

test("turnstile fails closed when half configured", async () => {
  assert.equal(await verifyTurnstile({ secret: "s", siteKey: "" }), false);
  assert.equal(await verifyTurnstile({ secret: "", siteKey: "k" }), false);
});

test("turnstile rejects a missing token without calling Cloudflare", async () => {
  let called = false;
  await withFetch(
    async () => {
      called = true;
      return { ok: true, json: async () => ({ success: true }) };
    },
    async () => {
      assert.equal(await verifyTurnstile({ secret: "s", siteKey: "k", token: "" }), false);
    }
  );
  assert.equal(called, false);
});

test("turnstile calls siteverify and trusts the server verdict", async () => {
  const calls = [];
  await withFetch(
    async (url, init) => {
      calls.push({ url, body: init.body });
      return { ok: true, json: async () => ({ success: true }) };
    },
    async () => {
      const ok = await verifyTurnstile({
        secret: "the-secret",
        siteKey: "the-key",
        token: "a-real-token",
        ip: "203.0.113.9",
      });
      assert.equal(ok, true);
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.match(calls[0].body, /secret=the-secret/);
  assert.match(calls[0].body, /response=a-real-token/);
  assert.match(calls[0].body, /remoteip=203\.0\.113\.9/);
});

test("turnstile rejects when Cloudflare says no", async () => {
  await withFetch(
    async () => ({ ok: true, json: async () => ({ success: false }) }),
    async () => {
      assert.equal(
        await verifyTurnstile({ secret: "s", siteKey: "k", token: "forged" }),
        false
      );
    }
  );
});

test("turnstile rejects on network error or non-2xx", async () => {
  await withFetch(
    async () => {
      throw new Error("network down");
    },
    async () => {
      assert.equal(await verifyTurnstile({ secret: "s", siteKey: "k", token: "t" }), false);
    }
  );

  await withFetch(
    async () => ({ ok: false, json: async () => ({ success: true }) }),
    async () => {
      assert.equal(await verifyTurnstile({ secret: "s", siteKey: "k", token: "t" }), false);
    }
  );
});

test("turnstile ignores a client-side 'success' it never received", async () => {
  // The token must actually be exchanged; a truthy string alone is not proof.
  await withFetch(
    async () => ({ ok: true, json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }) }),
    async () => {
      assert.equal(
        await verifyTurnstile({ secret: "s", siteKey: "k", token: "aaaaaaaaaaaaaaaaaaaaaaaa" }),
        false
      );
    }
  );
});
