import { json, readJson, guardJsonMutation, verifyPassword } from "../../_lib/common.js";
import { requireSession } from "../../_lib/auth.js";
import { reserveCredentialAttempt, releaseAuthFailure, tooManyAttempts } from "../../_lib/throttle.js";
import { buildRecoveryCodeRows, generateRecoveryCodes } from "../../_lib/recovery.js";

/**
 * How many backup codes are left.
 *
 * The codes themselves are never returned here. A session alone must not be
 * enough to read them, because a stolen session would then become a permanent
 * way back in even after the password changes.
 */
export async function onRequestGet(context) {
  const session = await requireSession(context);
  if (!session?.userID) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const row = await context.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN used_at IS NULL THEN 1 ELSE 0 END) AS remaining
     FROM recovery_codes WHERE user_id = ?`
  )
    .bind(session.userID)
    .first();

  return json({
    ok: true,
    total: Number(row?.total || 0),
    remaining: Number(row?.remaining || 0),
  });
}

/**
 * Replace the whole set with ten new codes.
 *
 * This is deliberately gated on the current password. A session is proof of
 * *presence*, not of the password: without this check, anyone holding a stolen
 * session could mint codes that survive the real owner changing their password
 * and take the account over later.
 */
export async function onRequestPost(context) {
  const { env, request } = context;
  const rejected = guardJsonMutation(request);
  if (rejected) return rejected;

  const session = await requireSession(context);
  if (!session?.userID) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await readJson(request);
  const password = String(body.password || "").trim();
  if (!password) {
    return json({ ok: false, error: "Current password is required." }, { status: 400 });
  }

  const clientIP = String(request.headers.get("CF-Connecting-IP") || "unknown").trim();
  const lock = await reserveCredentialAttempt(env, clientIP, "rotate");
  if (lock.blocked) return tooManyAttempts(lock);

  const user = await env.DB.prepare("SELECT id, salt, pin_hash FROM users WHERE id = ?")
    .bind(session.userID)
    .first();
  if (!user) {
    return json({ ok: false, error: "User not found." }, { status: 404 });
  }

  const check = await verifyPassword(password, user, env);
  if (!check.ok) {
    return json({ ok: false, error: "Current password is incorrect." }, { status: 401 });
  }

  const codes = generateRecoveryCodes();
  const rows = await buildRecoveryCodeRows(session.userID, codes);
  if (!rows.length) {
    return json({ ok: false, error: "Could not generate codes." }, { status: 500 });
  }

  // Delete and insert in one batch: a half-applied rotation could leave the old
  // set alive alongside the new one.
  const insert = env.DB.prepare(
    "INSERT INTO recovery_codes (id, user_id, code_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  await env.DB.batch([
    env.DB.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(session.userID),
    ...rows.map((row) => insert.bind(row.id, row.userID, row.codeHash, row.salt, row.createdAt)),
  ]);

  await releaseAuthFailure(env, clientIP, "rotate");
  return json({ ok: true, recoveryCodes: codes });
}
