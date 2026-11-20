/**
 * GET  /early-access/api/verify?email=&token=   confirm an address
 * POST /early-access/api/verify                 re-send the link
 *
 * The token is compared against a stored hash in constant time and expires
 * after 24 hours. A successful verification consumes the hash, so a link
 * cannot be replayed.
 */

import { json, guardJsonMutation, readJson, constantTimeEqual } from "../../../_lib/common.js";
import { reserveCredentialAttempt, releaseAuthFailure, tooManyAttempts } from "../../../_lib/throttle.js";
import { clientIp } from "../../../_lib/turnstile.js";
import {
  EVENT,
  normalizeEmail,
  isValidEmail,
  hashVerificationToken,
  generateVerificationToken,
  isTokenExpired,
  logEvent,
} from "../../../_lib/waitlist.js";
import { sendVerificationConfirmation } from "../../../_lib/email.js";

const VERIFY_SCOPE = "waitlist_verify";
const RESEND_SCOPE = "waitlist_resend";

export async function onRequestGet(context) {
  const { request, env } = context;

  const ip = clientIp(request);
  const lock = await reserveCredentialAttempt(env, ip, VERIFY_SCOPE);
  if (lock.blocked) return tooManyAttempts(lock);

  const params = new URL(request.url).searchParams;
  const email = normalizeEmail(params.get("email"));
  const token = String(params.get("token") || "").trim();

  if (!isValidEmail(email) || !token) {
    return renderError(400, "This verification link is incomplete or malformed.");
  }

  const row = await env.DB.prepare(
    `SELECT id, status, created_at, verification_sent_at, verification_token_hash
       FROM waitlist WHERE email = ?`
  )
    .bind(email)
    .first();

  if (!row) {
    await logEvent(env, {
      waitlistId: "unknown",
      type: EVENT.ERROR,
      detail: { stage: "verify", reason: "no_such_email" },
      request,
    });
    return renderError(404, "This verification link is not valid.");
  }

  if (row.status === "verified" || row.status === "invited") {
    return renderSuccess("Already verified", "This address is already confirmed. You are on the list.");
  }

  if (!row.verification_token_hash) {
    return renderError(400, "This link has already been used. Request a new one below.");
  }

  const presented = await hashVerificationToken(email, token);
  const matches = await constantTimeEqual(presented, row.verification_token_hash);
  if (!matches) {
    await logEvent(env, {
      waitlistId: row.id,
      type: EVENT.ERROR,
      detail: { stage: "verify", reason: "token_mismatch" },
      request,
    });
    return renderError(400, "This verification link is not valid.");
  }

  const tokenTime = row.verification_sent_at ?? row.created_at;
  
  if (isTokenExpired(tokenTime)) {
    return renderError(410, "This verification link has expired. Request a new one below.", {
      canResend: true,
      email,
    });
  }

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE waitlist
        SET status = 'verified',
            email_verified = 1,
            verified_at = ?,
            verification_token_hash = NULL,
            updated_at = ?
      WHERE id = ?`
  )
    .bind(now, now, row.id)
    .run();

  await logEvent(env, {
    waitlistId: row.id,
    type: EVENT.VERIFICATION,
    detail: { email },
    request,
  });

  // Send confirmation email
  try {
    await sendVerificationConfirmation(env, email, name);
  } catch (err) {
    // Log but don't fail the verification if email fails
    console.error("[verify] Failed to send confirmation email:", err);
  }

  await releaseAuthFailure(env, ip, VERIFY_SCOPE);

  return renderSuccess("You are on the list", "Your email is confirmed. We will email you when your invite is ready.");
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

  // Always answer the same way, whether or not the address exists.
  const generic = json(
    { ok: true, message: "If that address is registered, a new link is on its way." },
    { status: 202 }
  );

  if (!isValidEmail(email)) return generic;

  const row = await env.DB.prepare("SELECT id, status FROM waitlist WHERE email = ?")
    .bind(email)
    .first();

  if (!row || row.status === "verified" || row.status === "invited") {
    await releaseAuthFailure(env, ip, RESEND_SCOPE);
    return generic;
  }

  const token = generateVerificationToken();
  const tokenHash = await hashVerificationToken(email, token);
  const now = Date.now();

  await env.DB.prepare(
    "UPDATE waitlist SET verification_token_hash = ?, verification_sent_at = ?, updated_at = ? WHERE id = ?"
  )
    .bind(tokenHash, now, now, row.id)
    .run();

  await logEvent(env, {
    waitlistId: row.id,
    type: EVENT.VERIFICATION_RESENT,
    detail: { email },
    request,
  });

  console.log(`[waitlist] resent verification link for ${email}`);
  await releaseAuthFailure(env, ip, RESEND_SCOPE);

  return generic;
}

function renderSuccess(title, message) {
  return htmlPage(200, title, message, "");
}

function renderError(status, message, extra = {}) {
  const resend = extra.canResend
    ? `<form method="post" action="/early-access/api/verify" class="resend" data-email="${escapeHtml(
        extra.email || ""
      )}">
         <button type="submit">Send a new link</button>
       </form>`
    : "";
  return htmlPage(status, "Verification", message, resend);
}

/** Minimal standalone page: this one is opened from an email, not the app. */
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
  <div class="actions"><a href="https://bucksy.life/early-access">Back to Bucksy</a></div>
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
        await fetch("/early-access/api/verify", {
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
