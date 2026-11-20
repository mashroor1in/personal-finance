/**
 * GET /early-access/api/analytics
 *
 * Operator-only. Returns aggregate lifecycle numbers, never a full address.
 *
 * Access is by shared secret in the `x-admin-token` header. If
 * WAITLIST_ADMIN_TOKEN is not configured the route answers 404, so a
 * misconfigured deployment hides the endpoint instead of publishing it.
 */

import { json, constantTimeEqual } from "../../../_lib/common.js";

export async function onRequestGet(context) {
  const { request, env } = context;

  const expected = String(env.WAITLIST_ADMIN_TOKEN || "");
  if (!expected) {
    return json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const presented = String(request.headers.get("x-admin-token") || "");
  const allowed = presented && (await constantTimeEqual(presented, expected));
  if (!allowed) {
    // Slow the guesser down without telling them the route exists.
    return json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const [totals, recent, sources, countries] = await Promise.all([
    env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified,
         SUM(CASE WHEN status = 'invited'  THEN 1 ELSE 0 END) AS invited,
         SUM(CASE WHEN referred_by IS NOT NULL THEN 1 ELSE 0 END) AS referred,
         MIN(created_at) AS first_signup,
         MAX(created_at) AS last_signup
       FROM waitlist`
    ).first(),
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN created_at  > ? THEN 1 ELSE 0 END) AS signups_24h,
         SUM(CASE WHEN created_at  > ? THEN 1 ELSE 0 END) AS signups_7d,
         SUM(CASE WHEN verified_at > ? THEN 1 ELSE 0 END) AS verifications_7d
       FROM waitlist`
    )
      .bind(Date.now() - 86400000, Date.now() - 604800000, Date.now() - 604800000)
      .first(),
    env.DB.prepare(
      `SELECT signup_source AS source, COUNT(*) AS count
         FROM waitlist GROUP BY signup_source ORDER BY count DESC`
    ).all(),
    env.DB.prepare(
      `SELECT country, COUNT(*) AS count
         FROM waitlist WHERE country IS NOT NULL
         GROUP BY country ORDER BY count DESC LIMIT 10`
    ).all(),
  ]);

  const total = Number(totals?.total || 0);
  const verified = Number(totals?.verified || 0);

  return json(
    {
      ok: true,
      totals: {
        all: total,
        pending: Number(totals?.pending || 0),
        verified,
        invited: Number(totals?.invited || 0),
        referred: Number(totals?.referred || 0),
        verificationRate: total ? Math.round((verified / total) * 100) : 0,
        firstSignup: totals?.first_signup ?? null,
        lastSignup: totals?.last_signup ?? null,
      },
      recent: {
        signups24h: Number(recent?.signups_24h || 0),
        signups7d: Number(recent?.signups_7d || 0),
        verifications7d: Number(recent?.verifications_7d || 0),
      },
      sources: (sources?.results || []).map((row) => ({
        source: row.source,
        count: Number(row.count),
      })),
      countries: (countries?.results || []).map((row) => ({
        country: row.country,
        count: Number(row.count),
      })),
      generatedAt: Date.now(),
    },
    { status: 200 }
  );
}
