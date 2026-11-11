import { json } from "./common.js";

/**
 * Atomic D1 throttling for credential-guessing endpoints.
 *
 * KV's get-then-put let a parallel burst all read the same counter, so every
 * in-flight request could reach the password digest before the sixth wrote a
 * lock. D1's conditional upsert serialises the reservation, and the aggregate
 * rate bucket is never reset by a success.
 *
 * Two buckets per IP: a short window that caps total attempts, and a failure
 * counter that locks out repeated guesses with exponential backoff.
 */
const AUTH_FAIL_LIMIT = 5;
const AUTH_RATE_LIMIT = 30;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LOCK_BASE_MS = 5 * 60 * 1000;
const AUTH_LOCK_MAX_MS = 60 * 60 * 1000;
const AUTH_RATE_LOCK_MAX_MS = 15 * 60 * 1000;

function authBucketKeys(scope, ip) {
  const safe = toSafeKey(ip || "unknown");
  return {
    failure: `${scope}fail:ip:${safe}`,
    rate: `${scope}rate:ip:${safe}`,
  };
}

/**
 * Reserve one credential attempt, or report that the caller is locked out.
 *
 * `scope` separates independent secrets. Recovery codes use their own bucket so
 * that a user who just locked themselves out by mistyping passwords can still
 * redeem a code instead of waiting for the login lock to expire.
 */
export async function reserveCredentialAttempt(env, ip, scope = "auth") {
  const keys = authBucketKeys(scope, ip);
  const rate = await reserveAttempt(env, keys.rate, AUTH_RATE_LIMIT, AUTH_RATE_LOCK_MAX_MS);
  if (rate.blocked) return rate;
  return reserveAttempt(env, keys.failure, AUTH_FAIL_LIMIT, AUTH_LOCK_MAX_MS);
}

async function reserveAttempt(env, key, limit, maxLockMs) {
  const now = Date.now();
  const staleBefore = now - AUTH_WINDOW_MS;

  // An expired lock or an idle window starts a fresh count. The upsert below is
  // a single statement, so concurrent requests cannot lose each other's write.
  await env.DB.prepare(
    `UPDATE auth_throttle
     SET count = 0, lock_until = 0, window_start = ?, updated_at = ?
     WHERE key = ? AND lock_until <= ? AND (lock_until > 0 OR window_start < ?)`
  )
    .bind(now, now, key, now, staleBefore)
    .run();

  await env.DB.prepare(
    `INSERT INTO auth_throttle (key, count, window_start, lock_until, updated_at)
     VALUES (?, 1, ?, 0, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE
         WHEN auth_throttle.lock_until > ? THEN auth_throttle.count
         ELSE auth_throttle.count + 1
       END,
       lock_until = CASE
         WHEN auth_throttle.lock_until > ? THEN auth_throttle.lock_until
         WHEN auth_throttle.count + 1 > ?
           THEN ? + MIN(? * (1 << MIN(auth_throttle.count + 1 - (? + 1), 10)), ?)
         ELSE 0
       END,
       updated_at = ?`
  )
    .bind(
      key,
      now,
      now,
      now,
      now,
      limit,
      now,
      AUTH_LOCK_BASE_MS,
      limit,
      maxLockMs,
      now
    )
    .run();

  const row = await env.DB.prepare(
    "SELECT count, lock_until FROM auth_throttle WHERE key = ?"
  )
    .bind(key)
    .first();

  const lockUntil = Number(row?.lock_until || 0);
  if (lockUntil > now) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((lockUntil - now) / 1000)),
    };
  }

  return { blocked: false, retryAfterSeconds: 0 };
}

/** Give back the failure slot a correct credential earned. */
export async function releaseAuthFailure(env, ip, scope = "auth") {
  try {
    await env.DB.prepare(
      "UPDATE auth_throttle SET count = MAX(count - 1, 0) WHERE key = ? AND lock_until <= ?"
    )
      .bind(authBucketKeys(scope, ip).failure, Date.now())
      .run();
  } catch {
    // A cleanup failure must not turn a correct credential into a 500.
  }
}

export function tooManyAttempts(lock) {
  return json(
    { ok: false, error: `Too many attempts. Try again in ${lock.retryAfterSeconds}s.` },
    { status: 429, headers: { "Retry-After": String(lock.retryAfterSeconds) } }
  );
}

function toSafeKey(input) {
  return String(input || "unknown").toLowerCase().replace(/[^a-z0-9._:-]/g, "_").slice(0, 120);
}
