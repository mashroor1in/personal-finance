import { json } from "../../_lib/common.js";

export async function onRequestGet(context) {
  const users = await context.env.DB.prepare("SELECT COUNT(*) AS c FROM users WHERE id != 'default'").first();
  const siteKey = context.env.TURNSTILE_SITE_KEY || null;
  const secretSet = !!context.env.TURNSTILE_SECRET;
  const configured = !!siteKey && secretSet;

  // `enabled` is only true when both halves are present, because login.js fails
  // closed on a half-configured deployment. Do not advertise legacy sentinel
  // rows to unauthenticated callers.
  return json({
    ok: true,
    hasUsers: Number(users?.c || 0) > 0,
    turnstileEnabled: configured,
    turnstileSiteKey: configured ? siteKey : null,
    turnstileMisconfigured: !!siteKey !== secretSet,
  });
}
