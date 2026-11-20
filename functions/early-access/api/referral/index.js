/**
 * GET /early-access/api/referral?code=XXXX
 *
 * Public referral lookup. Returns counts and a masked name only — the referrer
 * never has their full address published to whoever holds the link.
 */

import { json } from "../../../_lib/common.js";
import { reserveCredentialAttempt, releaseAuthFailure, tooManyAttempts } from "../../../_lib/throttle.js";
import { clientIp } from "../../../_lib/turnstile.js";
import { EVENT, maskEmail, logEvent } from "../../../_lib/waitlist.js";

const REFERRAL_SCOPE = "waitlist_referral";

export async function onRequestGet(context) {
  const { request, env } = context;

  const ip = clientIp(request);
  const lock = await reserveCredentialAttempt(env, ip, REFERRAL_SCOPE);
  if (lock.blocked) return tooManyAttempts(lock);

  const code = String(new URL(request.url).searchParams.get("code") || "")
    .trim()
    .toUpperCase();

  if (!/^[A-Z0-9]{4,16}$/.test(code)) {
    return json({ ok: false, error: "A referral code is required." }, { status: 400 });
  }

  const row = await env.DB.prepare(
    `SELECT id, email, name, referral_code, referrals, verified_referrals
       FROM referral_counts WHERE referral_code = ?`
  )
    .bind(code)
    .first();

  await releaseAuthFailure(env, ip, REFERRAL_SCOPE);

  if (!row) {
    return json({ ok: false, error: "That referral code does not exist." }, { status: 404 });
  }

  await logEvent(env, {
    waitlistId: row.id,
    type: EVENT.REFERRAL_VIEW,
    detail: { code },
    request,
  });

  return json(
    {
      ok: true,
      referralCode: row.referral_code,
      referrer: {
        name: row.name || null,
        email: maskEmail(row.email),
      },
      stats: {
        referrals: Number(row.referrals) || 0,
        verified: Number(row.verified_referrals) || 0,
      },
    },
    { status: 200 }
  );
}
