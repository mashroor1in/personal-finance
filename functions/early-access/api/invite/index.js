/**
 * GET  /early-access/api/invite?email=&token=   accept an invitation
 * POST /early-access/api/invite                 resend invitation link
 *
 * Invitation links are different from verification links:
 * - They bypass the waitlist entirely
 * - They set the status to "invited" directly
 * - They have a longer expiration (14 days)
 * - They can be resent by admins
 */

import { json, guardJsonMutation, readJson } from "../../../_lib/common.js";
import { reserveCredentialAttempt, releaseAuthFailure, tooManyAttempts } from "../../../_lib/throttle.js";
import { clientIp } from "../../../_lib/turnstile.js";
import {
  EVENT,
  normalizeEmail,
  isValidEmail,
  hashVerificationToken,
  isTokenExpired,
  logEvent,
} from "../../../_lib/waitlist.js";
import { sendInvitationReminder } from "../../../_lib/email.js";

const INVITE_SCOPE = "waitlist_invite";
const RESEND_SCOPE = "waitlist_invite_resend";

export async function onRequestGet(context) {
  const { request, env } = context;

  const ip = clientIp(request);
  const lock = await reserveCredentialAttempt(env, ip, INVITE_SCOPE);
  if (lock.blocked) return tooManyAttempts(lock);

  const params = new URL(request.url).searchParams;
  const email = normalizeEmail(params.get("email"));
  const token = String(params.get("token") || "").trim();

  if (!isValidEmail(email) || !token) {
    return renderError(400, "This invitation link is incomplete or malformed.");
  }

  const row = await env.DB.prepare(
    `SELECT id, status, name, created_at, verification_sent_at, verification_token_hash
       FROM waitlist WHERE email = ?`
  )
    .bind(email)
    .first();

  await releaseAuthFailure(env, ip, INVITE_SCOPE);

  if (!row) {
    await logEvent(env, {
      waitlistId: "unknown",
      type: EVENT.ERROR,
      detail: { stage: "invite", reason: "no_such_email" },
      request,
    });
    return renderError(404, "This invitation link is not valid.");
  }

  if (row.status === "verified") {
    return renderSuccess("Already registered", "You have already activated your Bucksy account.");
  }

  if (!row.verification_token_hash) {
    return renderError(400, "This invitation has already been used. Please contact support.");
  }

  const presented = await hashVerificationToken(email, token);
  const matches = await import("../../../_lib/common.js").then(m => m.constantTimeEqual(presented, row.verification_token_hash));
  if (!matches) {
    await logEvent(env, {
      waitlistId: row.id,
      type: EVENT.ERROR,
      detail: { stage: "invite", reason: "token_mismatch" },
      request,
    });
    return renderError(400, "This invitation link is not valid.");
  }

  if (isTokenExpired(row.verification_sent_at)) {
    return renderError(410, "This invitation link has expired. Please contact the person who invited you.", {
      canResend: true,
      email,
    });
  }

  // Invitation is valid, redirect to the app with invitation token
  const redirectUrl = `https://bucksy.life/app?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  
  return new Response(null, {
    status: 302,
    headers: {
      "Location": redirectUrl,
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const badRequest = guardJsonMutation(request);
  if (badRequest) return badRequest;

  const ip = clientIp(request);
  const lock = await reserveCredentialAttempt(env, ip, RESEND_SCOPE);
  if (lock.blocked) return tooManyAttempts(lock);

  const body = await readJson(request);
  const email = normalizeEmail(body.email);

  if (!isValidEmail(email)) {
    await releaseAuthFailure(env, ip, RESEND_SCOPE);
    return json({ ok: false, error: "Invalid email address" }, { status: 400 });
  }

  const row = await env.DB.prepare("SELECT id, status, name FROM waitlist WHERE email = ?")
    .bind(email)
    .first();

  await releaseAuthFailure(env, ip, RESEND_SCOPE);

  if (!row || row.status !== "invited") {
    return json({ ok: false, error: "No active invitation found for this email." }, { status: 404 });
  }

  // Generate new token
  const { generateVerificationToken } = await import("../../../_lib/waitlist.js");
  const token = generateVerificationToken();
  const tokenHash = await hashVerificationToken(email, token);
  const now = Date.now();

  // Update with new token
  await env.DB.prepare(
    "UPDATE waitlist SET verification_token_hash = ?, verification_sent_at = ?, updated_at = ? WHERE id = ?"
  )
    .bind(tokenHash, now, now, row.id)
    .run();

  // Create new invitation link
  const invitationLink = `https://bucksy.life/early-access/invite?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;

  // Send reminder email
  try {
    await sendInvitationReminder(env, email, row.name, invitationLink, "14 days");
    
    await logEvent(env, {
      waitlistId: row.id,
      type: EVENT.INVITATION_RESENT,
      detail: { email },
      request,
    });

    return json({ 
      ok: true, 
      message: "A new invitation link has been sent to your email.",
    }, { status: 200 });

  } catch (err) {
    await logEvent(env, {
      waitlistId: row.id,
      type: EVENT.EMAIL_FAILED,
      detail: { reason: String(err?.message || "unknown").slice(0, 200) },
      request,
    });

    return json({ 
      ok: false, 
      error: "Failed to send invitation email. Please try again.",
    }, { status: 500 });
  }
}

function renderSuccess(title, message) {
  return htmlPage(200, title, message, "");
}

function renderError(status, message, extra = {}) {
  const resend = extra.canResend
    ? `<form method="post" action="/early-access/api/invite" class="resend" data-email="${escapeHtml(
        extra.email || ""
      )}">
         <button type="submit">Send a new invitation</button>
       </form>`
    : "";
  return htmlPage(status, "Invitation", message, resend);
}

/** Minimal standalone page for accepting invitations */
function htmlPage(status, title, message, extraHtml) {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} — Bucksy</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
       background:#F9F6EE;color:#102F27;
       font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  main{max-width:32rem;text-align:center}
  img{width:56px;margin-bottom:24px}
  h1{margin:0 0 12px;font-size:clamp(26px,5vw,34px);letter-spacing:-.02em}
  p{margin:0 0 24px;color:#566F62;line-height:1.6}
  .actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
  a,button{display:inline-block;padding:12px 22px;border-radius:999px;border:0;
           background:#0B3D2E;color:#F9F6EE;font:inherit;font-weight:600;
           text-decoration:none;cursor:pointer}
  a:hover,button:hover{background:#18815A}
  .resend button{background:transparent;color:#0B3D2E;border:2px solid #0B3D2E}
</style>
</head>
<body>
<main>
  <img src="/assets/mark.svg" alt="" width="56" height="62">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <div class="actions">
    <a href="https://bucksy.life/early-access">Back to Bucksy</a>
  </div>
  ${extraHtml}
</main>
<script>
  // The resend form is a plain HTML fallback; upgrade it to JSON + fetch.
  document.querySelectorAll("form.resend").forEach(function (form) {
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var button = form.querySelector("button");
      button.disabled = true;
      try {
        await fetch("/early-access/api/invite", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: form.dataset.email })
        });
      } catch (err) {}
      button.textContent = "Check your inbox";
    });
  });
</script>
</body>
</html>`;

  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    },
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}