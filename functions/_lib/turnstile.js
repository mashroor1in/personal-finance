/**
 * Server-side Turnstile verification.
 *
 * The client widget is a hint, never proof: the token must be exchanged with
 * Cloudflare from the worker before a signup is accepted. A token that has only
 * been checked in the browser is worth nothing, because the attacker controls
 * the browser.
 *
 * Configuration is all-or-nothing, matching /api/auth/login. With only one of
 * the two values set the deployment is half-configured and every request fails
 * closed instead of silently accepting unverified traffic.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile({ secret, siteKey, token, ip } = {}) {
  const secretSet = !!secret;
  const siteKeySet = !!siteKey;

  // Neither configured: the feature is off for this environment.
  if (!secretSet && !siteKeySet) return true;
  // Half configured: refuse rather than guess.
  if (!secretSet || !siteKeySet) return false;
  if (!token) return false;

  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (ip) form.set("remoteip", ip);

    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) return false;

    const data = await res.json();
    return data?.success === true;
  } catch {
    // Network failure is a refusal, not a pass.
    return false;
  }
}

/**
 * Client IP as reported by Cloudflare. The header is set by the edge, so it
 * cannot be spoofed by the caller on a normal request.
 */
export function clientIp(request) {
  return String(request.headers.get("CF-Connecting-IP") || "").trim() || "unknown";
}
