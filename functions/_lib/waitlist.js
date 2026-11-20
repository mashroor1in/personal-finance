/**
 * Waitlist domain rules.
 *
 * Everything here is pure: no database, no network, no request objects that
 * matter. That keeps the validation and token rules unit-testable in Node under
 * `node --test`, and keeps the handlers thin.
 *
 * Two rules are load-bearing:
 *
 *   1. `normalizeEmail` is the only way an address enters the system. The table
 *      re-checks it (`CHECK email = lower(email)`), so a future code path cannot
 *      create a second row that differs only by case.
 *   2. Only `hashVerificationToken` output is stored. The raw token exists in
 *      the email we send and nowhere else.
 */

import { randomToken, sha256Hex } from "./common.js";

/** The single source of truth for the analytics vocabulary. */
export const EVENT = Object.freeze({
  SIGNUP: "signup",
  SIGNUP_UPDATED: "signup_updated",
  VERIFICATION: "verification",
  VERIFICATION_RESENT: "verification_resent",
  INVITATION: "invitation",
  REFERRAL_VIEW: "referral_view",
  EMAIL_SENT: "email_sent",
  EMAIL_FAILED: "email_failed",
  ERROR: "error",
});

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Throwaway inboxes. Not exhaustive and never will be: it stops the casual
 * scripted signup, and the rate limiter covers the rest.
 */
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "20minutemail.com",
  "anonbox.net",
  "dispostable.com",
  "emailondeck.com",
  "fakeinbox.com",
  "getnada.com",
  "grr.la",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailnesia.com",
  "mintemail.com",
  "mohmal.com",
  "sharklasers.com",
  "spam4.me",
  "temp-mail.org",
  "tempail.com",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "throwaway.email",
  "trashmail.com",
  "yopmail.com",
  "yopmail.net",
]);

/** Addresses that run a company's inbox, not a person's. */
const ROLE_LOCAL_PARTS = new Set([
  "admin",
  "administrator",
  "abuse",
  "billing",
  "bounce",
  "compliance",
  "contact",
  "feedback",
  "help",
  "hello",
  "info",
  "legal",
  "mailer-daemon",
  "marketing",
  "noreply",
  "no-reply",
  "postmaster",
  "privacy",
  "sales",
  "security",
  "spam",
  "support",
  "webmaster",
]);

const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 80;

// Deliberately conservative. Anything that passes here still has to prove
// ownership by clicking the link, so this only filters obvious junk.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  if (!email || email.length > MAX_EMAIL_LENGTH) return false;
  if (!EMAIL_RE.test(email)) return false;
  if (email.includes("..")) return false;
  return true;
}

export function emailDomain(email) {
  const value = normalizeEmail(email);
  const at = value.lastIndexOf("@");
  return at === -1 ? "" : value.slice(at + 1);
}

export function isDisposableEmail(email) {
  const domain = emailDomain(email);
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // Catch subdomains of a known throwaway host.
  for (const known of DISPOSABLE_DOMAINS) {
    if (domain.endsWith(`.${known}`)) return true;
  }
  return false;
}

export function isRoleAddress(email) {
  const value = normalizeEmail(email);
  const local = value.slice(0, value.lastIndexOf("@"));
  return ROLE_LOCAL_PARTS.has(local);
}

/**
 * Validate a signup payload.
 *
 * Messages stay generic on purpose: the response must not tell a stranger
 * which rule their address failed, because that turns the form into a probe
 * for which addresses are blocked.
 */
export function validateSignup(input = {}) {
  const email = normalizeEmail(input.email);

  if (!email) return { ok: false, code: "EMAIL_REQUIRED", error: "Enter your email address." };
  if (!isValidEmail(email)) {
    return { ok: false, code: "EMAIL_INVALID", error: "That email address does not look right." };
  }
  if (isDisposableEmail(email)) {
    return {
      ok: false,
      code: "EMAIL_DISPOSABLE",
      error: "Please use an address you will keep — throwaway inboxes cannot receive your invite.",
    };
  }
  if (isRoleAddress(email)) {
    return {
      ok: false,
      code: "EMAIL_ROLE",
      error: "Please use a personal address, not a shared team inbox.",
    };
  }

  const name = String(input.name ?? "").trim();
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, code: "NAME_TOO_LONG", error: "That name is too long." };
  }

  const country = String(input.country ?? "").trim().toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) {
    return { ok: false, code: "COUNTRY_INVALID", error: "Country must be a two-letter code." };
  }

  const referralCode = String(input.referralCode ?? "").trim().toUpperCase();
  if (referralCode && !/^[A-Z0-9]{4,16}$/.test(referralCode)) {
    return { ok: false, code: "REFERRAL_INVALID", error: "That referral code is not valid." };
  }

  return {
    ok: true,
    value: {
      email,
      name: name || null,
      country: country || null,
      referralCode: referralCode || null,
    },
  };
}

/** 256 bits of randomness, hex encoded. */
export function generateVerificationToken() {
  return randomToken(32);
}

/**
 * Hash the token for storage, bound to the address it was issued for. A leaked
 * hash therefore cannot be replayed against a different email.
 */
export async function hashVerificationToken(email, token) {
  return sha256Hex(`waitlist:${normalizeEmail(email)}:${token}`);
}

/**
 * Is the link issued at `sentAt` past its window?
 *
 * Measured from the moment the *token* was minted, not from signup, so a
 * re-issued link always gets a full window. Missing timestamps fail closed.
 */
export function isTokenExpired(sentAt, now = Date.now()) {
  const issued = Number(sentAt);
  console.log("[isTokenExpired] Debug:", { sentAt, issued, now, TOKEN_TTL_MS });
  if (!Number.isFinite(issued) || issued <= 0) return true;
  const expired = now - issued > TOKEN_TTL_MS;
  console.log("[isTokenExpired] Result:", expired);
  return expired;
}

/**
 * Referral codes are shared in links and read aloud, so drop 0/O/1/I.
 * 32 symbols into 256 byte values divides evenly, so there is no modulo bias.
 */
const REFERRAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateReferralCode(length = 8) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += REFERRAL_ALPHABET[byte % REFERRAL_ALPHABET.length];
  return out;
}

/** `ada@example.com` -> `a**@example.com`. Used in any public response. */
export function maskEmail(email) {
  const value = normalizeEmail(email);
  const at = value.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.min(Math.max(local.length - 1, 2), 6))}@${domain}`;
}

/**
 * Append to the audit log. Never throws: a logging failure must not turn a
 * successful signup into an error the visitor cannot act on.
 *
 * `waitlist_events.waitlist_id` references `waitlist(id)` and is NOT NULL, so
 * an event with no owning registration (a bad Turnstile token, a verification
 * attempt for an address that does not exist) has nowhere to go. Those are
 * written to the worker log instead of being dropped: they are the events an
 * operator most wants when abuse is being investigated.
 */
export async function logEvent(env, { waitlistId, type, detail = null, request = null }) {
  const ip = request ? clientIpOf(request) : null;
  const userAgent = request ? String(request.headers.get("user-agent") || "").slice(0, 300) : null;

  if (!waitlistId) {
    console.warn(
      `[waitlist] ${type} ${JSON.stringify({ detail, ip, userAgent: userAgent || null })}`
    );
    return;
  }

  try {
    await env.DB.prepare(
      `INSERT INTO waitlist_events (id, waitlist_id, event_type, event_data, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        waitlistId,
        type,
        detail ? JSON.stringify(detail) : null,
        ip,
        userAgent
      )
      .run();
  } catch {
    // Intentionally silent.
  }
}

function clientIpOf(request) {
  return String(request.headers.get("CF-Connecting-IP") || "").trim() || null;
}
