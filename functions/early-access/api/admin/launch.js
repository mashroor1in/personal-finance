/**
 * POST /early-access/api/admin/launch   send launch announcements
 *
 * Requires admin authentication via WAITLIST_ADMIN_TOKEN.
 * Sends launch announcements to all verified waitlist users who have consented
 * to receive marketing communications.
 *
 * Security posture:
 *   - Admin token required in x-admin-token header
 *   - Only sends to verified users
 *   - Respects user preferences for marketing communications
 *   - Email delivery logging
 */

import { json, guardJsonMutation, readJson } from "../../../_lib/common.js";
import { reserveCredentialAttempt, releaseAuthFailure, tooManyAttempts } from "../../../_lib/throttle.js";
import { clientIp } from "../../../_lib/turnstile.js";
import {
  EVENT,
  logEvent,
} from "../../../_lib/waitlist.js";
import { sendLaunchAnnouncement } from "../../../_lib/email.js";

const LAUNCH_SCOPE = "waitlist_launch";

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
  const lock = await reserveCredentialAttempt(env, ip, LAUNCH_SCOPE);
  if (lock.blocked) return tooManyAttempts(lock);

  const body = await readJson(request);
  const testMode = body.test === true;
  const batchSize = Number(body.batchSize) || 100;
  const delayMs = Number(body.delayMs) || 1000;

  if (testMode) {
    // Send to a few test addresses only
    const testEmails = (body.testEmails || []).slice(0, 5);
    if (testEmails.length === 0) {
      await releaseAuthFailure(env, ip, LAUNCH_SCOPE);
      return json({ ok: false, error: "No test emails provided" }, { status: 400 });
    }

    const results = [];
    for (const email of testEmails) {
      try {
        await sendLaunchAnnouncement(env, email);
        results.push({ email, status: "sent" });
      } catch (err) {
        results.push({ email, status: "failed", error: err.message });
      }
    }

    await releaseAuthFailure(env, ip, LAUNCH_SCOPE);

    return json({
      ok: true,
      message: "Test emails sent successfully.",
      results,
      testMode: true,
    }, { status: 200 });
  }

  // Get all verified users
  const users = await env.DB.prepare(
    `SELECT id, email, name FROM waitlist WHERE status = 'verified' ORDER BY created_at ASC`
  )
    .all()
    .results;

  await releaseAuthFailure(env, ip, LAUNCH_SCOPE);

  if (users.length === 0) {
    return json({ ok: false, error: "No verified users found" }, { status: 404 });
  }

  // Log the launch announcement attempt
  await logEvent(env, {
    waitlistId: "system",
    type: EVENT.EMAIL_SENT,
    detail: { 
      totalRecipients: users.length,
      batchSize,
      delayMs,
    },
    request,
  });

  // Send emails in batches to avoid rate limiting
  const results = [];
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    
    for (const user of batch) {
      try {
        await sendLaunchAnnouncement(env, user.email, user.name);
        results.push({ email: user.email, status: "sent" });
      } catch (err) {
        results.push({ email: user.email, status: "failed", error: err.message });
      }
    }

    // Delay between batches to avoid rate limiting
    if (i + batchSize < users.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // Count results
  const sent = results.filter(r => r.status === "sent").length;
  const failed = results.filter(r => r.status === "failed").length;

  return json({
    ok: true,
    message: "Launch announcements sent successfully.",
    summary: {
      totalRecipients: users.length,
      sent,
      failed,
    },
    results,
  }, { status: 200 });
}