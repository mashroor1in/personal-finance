/**
 * POST /early-access/api/waitlist   register (or re-send verification)
 * GET  /early-access/api/waitlist   check one registration's status
 *
 * Security posture:
 *   - same-origin JSON only (`guardJsonMutation`)
 *   - one atomic D1 throttle per IP, shared with nothing else
 *   - Turnstile verified server-side; the client result is ignored
 *   - only a token *hash* is stored, bound to the address
 *   - a successful call refunds its throttle slot, so only failures accumulate
 */

import { json, guardJsonMutation, readJson } from "../../../_lib/common.js";
import { reserveCredentialAttempt, releaseAuthFailure, tooManyAttempts } from "../../../_lib/throttle.js";
import { verifyTurnstile, clientIp } from "../../../_lib/turnstile.js";
import {
  EVENT,
  validateSignup,
  normalizeEmail,
  isValidEmail,
  generateVerificationToken,
  hashVerificationToken,
  generateReferralCode,
  logEvent,
} from "../../../_lib/waitlist.js";

const SIGNUP_SCOPE = "waitlist";
const STATUS_SCOPE = "waitlist_status";
const MAX_REFERRAL_ATTEMPTS = 5;

const GENERIC_SENT =
  "Check your inbox — if that address can join, a verification link is on its way.";

export async function onRequestPost(context) {
  const { request, env } = context;

  const badRequest = guardJsonMutation(request);
  if (badRequest) return badRequest;

  const ip = clientIp(request);
  const lock = await reserveCredentialAttempt(env, ip, SIGNUP_SCOPE);
  if (lock.blocked) return tooManyAttempts(lock);

  const body = await readJson(request);

  // Accept both spellings: the landing page sends `turnstileToken`, older
  // callers may send `turnstile_token`.
  const turnstileToken = String(body.turnstileToken || body.turnstile_token || "").trim();

  const human = await verifyTurnstile({
    secret: env.TURNSTILE_SECRET,
    siteKey: env.TURNSTILE_SITE_KEY,
    token: turnstileToken,
    ip: ip === "unknown" ? "" : ip,
  });
  if (!human) {
    await logEvent(env, {
      waitlistId: "unknown",
      type: EVENT.ERROR,
      detail: { stage: "turnstile", ip },
      request,
    });
    return json({ ok: false, error: "Please complete human verification." }, { status: 403 });
  }

  const checked = validateSignup({
    email: body.email,
    name: body.name,
    country: body.country,
    referralCode: body.referralCode || body.referral_code,
  });
  if (!checked.ok) {
    return json({ ok: false, code: checked.code, error: checked.error }, { status: 400 });
  }

  const { email, name, country, referralCode } = checked.value;
  const now = Date.now();

  let referrerId = null;
  if (referralCode) {
    // An unknown code must not block the signup; it just does not credit anyone.
    const referrer = await env.DB.prepare("SELECT id FROM waitlist WHERE referral_code = ?")
      .bind(referralCode)
      .first();
    referrerId = referrer?.id || null;
  }

  const existing = await env.DB.prepare(
    "SELECT id, status FROM waitlist WHERE email = ?"
  )
    .bind(email)
    .first();

  if (existing) {
    if (existing.status === "verified" || existing.status === "invited") {
      // Explicit and safe: the caller already knows this address, and silence
      // here reads as a broken form.
      return json(
        { ok: false, code: "ALREADY_REGISTERED", error: "This email is already on the waitlist." },
        { status: 409 }
      );
    }

    const token = generateVerificationToken();
    const tokenHash = await hashVerificationToken(email, token);

    await env.DB.prepare(
      `UPDATE waitlist
          SET name = COALESCE(?, name),
              country = COALESCE(?, country),
              referred_by = COALESCE(referred_by, ?),
              verification_token_hash = ?,
              verification_sent_at = ?,
              updated_at = ?
        WHERE id = ?`
    )
      .bind(name, country, referrerId, tokenHash, now, now, existing.id)
      .run();

    await logEvent(env, {
      waitlistId: existing.id,
      type: EVENT.SIGNUP_UPDATED,
      detail: { email, hasReferral: !!referrerId },
      request,
    });

    await deliverVerification(env, { id: existing.id, email, name, token, request });

    await releaseAuthFailure(env, ip, SIGNUP_SCOPE);
    return json({ ok: true, status: "pending", message: GENERIC_SENT }, { status: 202 });
  }

  const id = crypto.randomUUID();
  const token = generateVerificationToken();
  const tokenHash = await hashVerificationToken(email, token);

  // A collision on the 8-char referral code is unlikely but not impossible, so
  // retry with a fresh code instead of surfacing a 500.
  let issuedCode = null;
  for (let attempt = 0; attempt < MAX_REFERRAL_ATTEMPTS; attempt += 1) {
    const candidate = generateReferralCode();
    try {
      await env.DB.prepare(
        `INSERT INTO waitlist
           (id, email, name, country, referral_code, referred_by, signup_source,
            status, email_verified, verification_token_hash, verification_sent_at,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'early-access', 'pending', 0, ?, ?, ?, ?)`
      )
        .bind(id, email, name, country, candidate, referrerId, tokenHash, now, now, now)
        .run();
      issuedCode = candidate;
      break;
    } catch (err) {
      const message = String(err?.message || "");
      // Someone else claimed the address in the same instant.
      if (message.includes("waitlist.email")) {
        return json(
          { ok: false, code: "ALREADY_REGISTERED", error: "This email is already on the waitlist." },
          { status: 409 }
        );
      }
      // Different referral code, try again.
      if (message.includes("referral_code") && attempt < MAX_REFERRAL_ATTEMPTS - 1) continue;
      throw err;
    }
  }

  if (!issuedCode) {
    return json({ ok: false, error: "Could not complete registration. Please retry." }, { status: 503 });
  }

  await logEvent(env, {
    waitlistId: id,
    type: EVENT.SIGNUP,
    detail: { email, hasName: !!name, country, referredBy: referrerId },
    request,
  });

  await deliverVerification(env, { id, email, name, token, request });

  await releaseAuthFailure(env, ip, SIGNUP_SCOPE);

  return json(
    {
      ok: true,
      status: "pending",
      referralCode: issuedCode,
      message: GENERIC_SENT,
    },
    { status: 201 }
  );
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const ip = clientIp(request);
  const lock = await reserveCredentialAttempt(env, ip, STATUS_SCOPE);
  if (lock.blocked) return tooManyAttempts(lock);

  let email = "";
  try {
    email = normalizeEmail(new URL(request.url).searchParams.get("email"));
  } catch {
    email = "";
  }

  if (!isValidEmail(email)) {
    return json({ ok: false, error: "A valid email parameter is required." }, { status: 400 });
  }

  const row = await env.DB.prepare(
    `SELECT status, created_at, verified_at, invited_at, referral_code
       FROM waitlist WHERE email = ?`
  )
    .bind(email)
    .first();

  await releaseAuthFailure(env, ip, STATUS_SCOPE);

  if (!row) {
    return json({ ok: true, registered: false }, { status: 200 });
  }

  return json(
    {
      ok: true,
      registered: true,
      status: row.status,
      createdAt: row.created_at ?? null,
      verifiedAt: row.verified_at ?? null,
      invitedAt: row.invited_at ?? null,
      referralCode: row.referral_code ?? null,
    },
    { status: 200 }
  );
}

/**
 * Hand the token to the mailer.
 *
 * Email delivery is not wired yet, so this records the attempt and logs the
 * token to the worker console in non-production. It returns nothing: a mail
 * failure must not roll back a registration that already committed.
 */
async function deliverVerification(env, { id, email, name, token, request }) {
  const link = `https://bucksy.life/early-access/api/verify?email=${encodeURIComponent(
    email
  )}&token=${encodeURIComponent(token)}`;

  await logEvent(env, {
    waitlistId: id,
    type: EVENT.EMAIL_SENT,
    detail: { to: "redacted", linkIssued: true },
    request,
  });

  if (!env.WAITLIST_EMAIL_ENDPOINT) {
    // No mailer configured. Leave a breadcrumb for the operator running
    // `wrangler pages deployment tail`, never the token in a response body.
    console.log(`[waitlist] verification link for ${email}: ${link}`);
    return;
  }

  try {
    const res = await fetch(env.WAITLIST_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.WAITLIST_EMAIL_TOKEN ? { authorization: `Bearer ${env.WAITLIST_EMAIL_TOKEN}` } : {}),
      },
      body: JSON.stringify({ to: email, name, link, template: "waitlist_verify" }),
    });
    if (!res.ok) throw new Error(`mailer responded ${res.status}`);
  } catch (err) {
    await logEvent(env, {
      waitlistId: id,
      type: EVENT.EMAIL_FAILED,
      detail: { reason: String(err?.message || "unknown").slice(0, 200) },
      request,
    });
  }
}
