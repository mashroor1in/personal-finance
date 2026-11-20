/**
 * POST /early-access/api/admin/invite   invite a user to Early Access
 *
 * Requires admin authentication via WAITLIST_ADMIN_TOKEN.
 * Generates a unique invitation link and emails the user.
 * The invitation link allows the user to skip the waitlist and go directly
 * to account creation.
 *
 * Security posture:
 *   - Admin token required in x-admin-token header
 *   - Email validation and normalization
 *   - Unique invitation links with expiration
 *   - Email delivery logging
 */

import { json, guardJsonMutation, readJson } from "../../../_lib/common.js";
import { reserveCredentialAttempt, releaseAuthFailure, tooManyAttempts } from "../../../_lib/throttle.js";
import { clientIp } from "../../../_lib/turnstile.js";
import {
  EVENT,
  normalizeEmail,
  isValidEmail,
  generateVerificationToken,
  hashVerificationToken,
  generateReferralCode,
  logEvent,
} from "../../../_lib/waitlist.js";
import { sendInvitation } from "../../../_lib/email.js";

const INVITE_SCOPE = "waitlist_invite";
const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export async function onRequestPost(context) {
  const { request, env } = context;

  // Verify admin token
  const expected = String(env.WAITLIST_ADMIN_TOKEN || "");
  if (!expected) {
    return json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const presented = String(request.headers.get("x-admin-token") || "");
  const allowed = presented && (await import("../../../_lib/common.js").then(m => m.constantTimeEqual(presented, expected)));
  if (!allowed) {
    return json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const badRequest = guardJsonMutation(request);
  if (badRequest) return badRequest;

  const ip = clientIp(request);
  const lock = await reserveCredentialAttempt(env, ip, INVITE_SCOPE);
  if (lock.blocked) return tooManyAttempts(lock);

  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const name = String(body.name || "").trim();

  if (!isValidEmail(email)) {
    await releaseAuthFailure(env, ip, INVITE_SCOPE);
    return json({ ok: false, error: "Invalid email address" }, { status: 400 });
  }

  // Check if user is already on waitlist
  const existing = await env.DB.prepare("SELECT id, status FROM waitlist WHERE email = ?")
    .bind(email)
    .first();

  let waitlistId = null;
  if (existing) {
    waitlistId = existing.id;
    // If already invited or verified, return early
    if (existing.status === "invited" || existing.status === "verified") {
      await releaseAuthFailure(env, ip, INVITE_SCOPE);
      return json({ 
        ok: true, 
        message: "User is already on the waitlist.",
        status: existing.status 
      });
    }
  } else {
    // Create waitlist entry for invited user
    waitlistId = crypto.randomUUID();
    const referralCode = generateReferralCode();
    const now = Date.now();

    await env.DB.prepare(
      `INSERT INTO waitlist
         (id, email, name, referral_code, signup_source, status, email_verified,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin-invite', 'invited', 1, ?, ?)`
    )
      .bind(waitlistId, email, name, referralCode, now, now)
      .run();
  }

  // Generate invitation token
  const token = generateVerificationToken();
  const tokenHash = await hashVerificationToken(email, token);
  const now = Date.now();

  // Store invitation token
  await env.DB.prepare(
    `UPDATE waitlist
        SET status = 'invited',
            verification_token_hash = ?,
            verification_sent_at = ?,
            invited_at = ?,
            updated_at = ?
      WHERE id = ?`
  )
    .bind(tokenHash, now, now, now, waitlistId)
    .run();

  // Create invitation link
  const invitationLink = `https://bucksy.life/early-access/invite?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;

  // Send invitation email
  try {
    await sendInvitation(env, email, name, invitationLink);
    
    await logEvent(env, {
      waitlistId,
      type: EVENT.INVITATION,
      detail: { to: "redacted", invitationLink: true },
      request,
    });

    await releaseAuthFailure(env, ip, INVITE_SCOPE);

    return json({
      ok: true,
      message: "Invitation sent successfully.",
      email,
      status: "invited",
    }, { status: 200 });

  } catch (err) {
    await logEvent(env, {
      waitlistId,
      type: EVENT.EMAIL_FAILED,
      detail: { reason: String(err?.message || "unknown").slice(0, 200) },
      request,
    });

    await releaseAuthFailure(env, ip, INVITE_SCOPE);

    return json({
      ok: false,
      error: "Failed to send invitation email. Please try again.",
      email,
    }, { status: 500 });
  }
}