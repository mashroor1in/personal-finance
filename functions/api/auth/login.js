import { json, readJson, randomToken, sessionCookie, parseCookies, guardJsonMutation, hashPassword, verifyPassword } from "../../_lib/common.js";
import { requireSession, sessionVersion } from "../../_lib/auth.js";
import { reserveCredentialAttempt, releaseAuthFailure, tooManyAttempts } from "../../_lib/throttle.js";
import {
  buildRecoveryCodeRows,
  generateRecoveryCodes,
  isValidRecoveryCode,
  matchesRecoveryCode,
} from "../../_lib/recovery.js";
import { purgeAfterFrom, purgeExpiredDeletedData, DELETED_DATA_RETENTION_DAYS } from "../../_lib/retention.js";

export async function onRequestPost(context) {
  const { env, request } = context;
  const rejected = guardJsonMutation(request);
  if (rejected) return rejected;

  const body = await readJson(request);
  const mode = String(body.mode || "login").trim();
  const username = normalizeUsername(body.username);
  const clientIP = String(request.headers.get("CF-Connecting-IP") || "unknown").trim();
  const password = String(body.password || "").trim();
  const currentPassword = String(body.currentPassword || "").trim();
  const confirmPassword = String(body.confirmPassword || "").trim();
  const resetConfirm = String(body.resetConfirm || "").trim();
  const turnstileToken = String(body.turnstileToken || "").trim();
  const recoveryCode = String(body.code || body.recoveryCode || "").trim();

  if (!["register", "login", "changepassword", "resetaccount", "recover"].includes(mode)) {
    return json({ ok: false, error: "Invalid auth mode." }, { status: 400 });
  }

  const badPassword = () => json({ ok: false, error: "Password must be at least 6 characters." }, { status: 400 });
  // Recovery is unauthenticated and guesses a secret, so it shares the same
  // throttle and bot check as login. Otherwise it is a free oracle on the
  // codes.
  const isPublicAuthMode = mode === "register" || mode === "login" || mode === "recover";
  // Recovery codes are a different secret from the password, so they get their
  // own throttle bucket. Otherwise five mistyped passwords would also lock the
  // user out of the recovery path they are about to need.
  const throttleScope = mode === "recover" ? "recover" : "auth";

  if (isPublicAuthMode) {
    const lock = await reserveCredentialAttempt(env, clientIP, throttleScope);
    if (lock.blocked) return tooManyAttempts(lock);
  }

  if (isPublicAuthMode) {
    const turnstileValid = await verifyTurnstile({
      secret: env.TURNSTILE_SECRET,
      siteKey: env.TURNSTILE_SITE_KEY,
      token: turnstileToken,
      ip: request.headers.get("CF-Connecting-IP") || "",
    });
    if (!turnstileValid) {
      return json({ ok: false, error: "Please complete human verification." }, { status: 400 });
    }
  }

  if (mode === "register") {
    if (!isValidUsername(username) || isReservedUsername(username)) {
      return json({ ok: false, error: "Username must be 3-32 chars (letters, numbers, ., _, -)." }, { status: 400 });
    }
    if (password.length < 6) return badPassword();
    if (password !== confirmPassword) {
      return json({ ok: false, error: "Password confirmation does not match." }, { status: 400 });
    }

    const existing = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(username).first();
    if (existing) {
      return json({ ok: false, error: "Username already exists." }, { status: 409 });
    }

    const { salt, pinHash } = await hashPassword(password, env);
    await env.DB.prepare("INSERT INTO users (id, salt, pin_hash, updated_at) VALUES (?, ?, ?, ?)")
      .bind(username, salt, pinHash, Date.now())
      .run();

    // Pre-account data (`user_id = 'default'`) is deliberately never handed to
    // the next person who registers. Public registration cannot prove
    // ownership of those rows, and auto-transferring them let an unauthenticated
    // visitor seed data that the first real account then inherited. Legacy rows
    // stay in place until an explicit, authenticated claim exists.

    // A deleted username can be registered again. Any codes left behind must
    // not carry over, or the previous holder of the name would keep a way into
    // the new account.
    const recoveryCodes = await issueRecoveryCodes(env, username);

    // A successful registration proves the caller is not guessing at an
    // existing credential. It releases only the slot this request reserved;
    // the aggregate rate bucket is never reset by success.
    await releaseAuthFailure(env, clientIP);
    await purgeExpiredDeletedData(env);
    return await issueSessionAndRespond(
      env,
      username,
      recoveryCodes.length ? { recoveryCodes } : {}
    );
  }

  if (mode === "login") {
    if (!isValidUsername(username)) {
      return json({ ok: false, error: "Username is required." }, { status: 400 });
    }
    if (!password) {
      return json({ ok: false, error: "Password is required." }, { status: 400 });
    }

    const user = await env.DB.prepare("SELECT id, salt, pin_hash FROM users WHERE id = ?").bind(username).first();
    if (!user) {
      return json({ ok: false, error: "Invalid username or password." }, { status: 401 });
    }

    const check = await verifyPassword(password, user, env);
    if (!check.ok) {
      return json({ ok: false, error: "Invalid username or password." }, { status: 401 });
    }

    // Upgrade a legacy or weaker-parameter verifier now that we hold the
    // plaintext. `updated_at` is left alone: the password itself did not
    // change, and the profile card reports it as the password's date.
    if (check.needsRehash) await upgradePasswordHash(env, user.id, password);

    await releaseAuthFailure(env, clientIP);
    await purgeExpiredDeletedData(env);
    return await issueSessionAndRespond(env, user.id);
  }

  if (mode === "recover") {
    // Same message for "no such user", "no such code" and "code already used",
    // so this cannot be used to enumerate accounts or codes.
    const rejected = () =>
      json({ ok: false, error: "Invalid username or recovery code." }, { status: 401 });

    if (!isValidUsername(username)) return rejected();
    if (!isValidRecoveryCode(recoveryCode)) {
      return json(
        { ok: false, error: "Recovery codes look like XXXX-XXXX-XXXX." },
        { status: 400 }
      );
    }
    if (password.length < 6) return badPassword();
    if (password !== confirmPassword) {
      return json({ ok: false, error: "New password confirmation does not match." }, { status: 400 });
    }

    const user = await env.DB.prepare("SELECT id, salt, pin_hash FROM users WHERE id = ?")
      .bind(username)
      .first();
    if (!user) return rejected();

    const stored = await env.DB.prepare(
      "SELECT id, salt, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL"
    )
      .bind(username)
      .all()
      .catch(() => null);
    if (!stored) {
      // Missing table (migration 0003 not applied) must not become an opaque
      // 500, which is unreadable without a live tail.
      return json(
        { ok: false, error: "Password recovery is not available right now. Contact the owner." },
        { status: 503 }
      );
    }
    const candidates = Array.isArray(stored?.results) ? stored.results : [];

    let matched = null;
    for (const row of candidates) {
      // Every candidate is checked, not just up to the match, so response time
      // does not reveal the position of a correct code in the list.
      if (await matchesRecoveryCode(recoveryCode, row)) matched = row;
    }
    if (!matched) return rejected();

    // Spend the code before touching the password. The conditional update makes
    // two concurrent redemptions race safely: exactly one changes a row.
    const burned = await env.DB.prepare(
      "UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL"
    )
      .bind(Date.now(), matched.id)
      .run();
    if (burned?.meta?.changes === 0) return rejected();

    const { salt: newSalt, pinHash: newHash } = await hashPassword(password, env);
    await env.DB.prepare("UPDATE users SET salt = ?, pin_hash = ?, updated_at = ? WHERE id = ?")
      .bind(newSalt, newHash, Date.now(), username)
      .run();

    await releaseAuthFailure(env, clientIP, "recover");
    await purgeExpiredDeletedData(env);

    // No session is issued. The user must sign in with the new password, which
    // proves the reset worked instead of stranding them in a session they
    // cannot reproduce. The new verifier rotates the session version, so every
    // older token for this account is dead.
    return json({
      ok: true,
      recovered: true,
      username,
      message: "Password reset. Sign in with your new password.",
    });
  }

  const session = await requireSession(context);
  if (!session?.userID) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Current-password checks are guesses too, so they share the same atomic
  // budget as login. Without this a stolen session was an unlimited password
  // oracle that could mint a durable replacement credential.
  const credentialLock = await reserveCredentialAttempt(env, clientIP);
  if (credentialLock.blocked) return tooManyAttempts(credentialLock);

  const userID = session.userID;
  const user = await env.DB.prepare("SELECT id, salt, pin_hash FROM users WHERE id = ?").bind(userID).first();
  if (!user) {
    return json({ ok: false, error: "User not found." }, { status: 404 });
  }

  if (mode === "changepassword") {
    if (!currentPassword) {
      return json({ ok: false, error: "Current password is required." }, { status: 400 });
    }
    if (password.length < 6) return badPassword();
    if (password !== confirmPassword) {
      return json({ ok: false, error: "New password confirmation does not match." }, { status: 400 });
    }

    const currentCheck = await verifyPassword(currentPassword, user, env);
    if (!currentCheck.ok) {
      return json({ ok: false, error: "Current password is incorrect." }, { status: 401 });
    }

    const { salt: newSalt, pinHash: newHash } = await hashPassword(password, env);
    await env.DB.prepare("UPDATE users SET salt = ?, pin_hash = ?, updated_at = ? WHERE id = ?")
      .bind(newSalt, newHash, Date.now(), userID)
      .run();

    await releaseAuthFailure(env, clientIP);
    return await issueSessionAndRespond(env, userID);
  }

  if (mode === "resetaccount") {
    if (!password) {
      return json({ ok: false, error: "Current password is required." }, { status: 400 });
    }
    if (resetConfirm !== "DELETE") {
      return json({ ok: false, error: "Confirm the account deletion and try again." }, { status: 400 });
    }

    const deleteCheck = await verifyPassword(password, user, env);
    if (!deleteCheck.ok) {
      return json({ ok: false, error: "Current password is incorrect." }, { status: 401 });
    }

    // The account itself closes at once: credentials, codes and sessions all
    // go. Only the planner history is kept, in `deleted_months`, for
    // DELETED_DATA_RETENTION_DAYS. That is the difference between a misclick
    // and losing years of records.
    const deletedAt = Date.now();
    const purgeAfter = purgeAfterFrom(deletedAt);
    const archive = env.DB.prepare(
      `INSERT INTO deleted_months
         (user_id, month, salary, items_json, paid_json, updated_at, created_at, deleted_at, purge_after)
       SELECT user_id, month, salary, items_json, paid_json, updated_at, created_at, ?, ?
       FROM months WHERE user_id = ?
       ON CONFLICT(user_id, month) DO UPDATE SET
         salary = excluded.salary,
         items_json = excluded.items_json,
         paid_json = excluded.paid_json,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at,
         purge_after = excluded.purge_after`
    ).bind(deletedAt, purgeAfter, userID);

    const scrub = [
      env.DB.prepare("DELETE FROM months WHERE user_id = ?").bind(userID),
      env.DB.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(userID),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userID),
    ];

    // One batch, so a crash cannot archive the rows without then unlinking
    // them from the live table, or delete them without an archived copy.
    try {
      await env.DB.batch([archive, ...scrub]);
    } catch (error) {
      // A deployment without migration 0004 has no recycle bin. A missing
      // archive must not block a deletion the user deliberately confirmed, so
      // fall back to the old immediate erase. Any other failure is real: let it
      // surface instead of quietly destroying the data.
      if (!/deleted_months/i.test(String(error?.message || ""))) throw error;
      await env.DB.batch(scrub);
    }

    await purgeExpiredDeletedData(env);

    const token = parseCookies(request).pf_session;
    if (token) {
      await env.SESSIONS.delete(`sess:${token}`);
    }

    await releaseAuthFailure(env, clientIP);
    return json(
      {
        ok: true,
        reset: true,
        retentionDays: DELETED_DATA_RETENTION_DAYS,
        message: `Account deleted. Your planner data is kept for ${DELETED_DATA_RETENTION_DAYS} days, then erased.`,
      },
      { headers: { "Set-Cookie": sessionCookie("") } }
    );
  }

  return json({ ok: false, error: "Unsupported mode." }, { status: 400 });
}

function normalizeUsername(input) {
  return String(input || "").trim().toLowerCase();
}

const RESERVED_USERNAMES = new Set([
  "default",
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "anonymous",
  "undefined",
  "null",
]);

function isValidUsername(username) {
  return /^[a-z0-9._-]{3,32}$/.test(username);
}

function isReservedUsername(username) {
  return username.startsWith("__") || RESERVED_USERNAMES.has(username);
}

/**
 * Replace a weak or legacy verifier in place.
 *
 * A failure here must not fail an otherwise correct login: the old hash still
 * verifies, and the next successful login will try again.
 */
async function upgradePasswordHash(env, userID, password) {
  try {
    const { salt, pinHash } = await hashPassword(password, env);
    await env.DB.prepare("UPDATE users SET salt = ?, pin_hash = ? WHERE id = ?")
      .bind(salt, pinHash, userID)
      .run();
  } catch {
    // Keep the working credential rather than turning login into a 500.
  }
}

async function issueSessionAndRespond(env, userID, extra = {}) {
  const user = await env.DB.prepare("SELECT created_at, updated_at, pin_hash FROM users WHERE id = ?")
    .bind(userID)
    .first();
  if (!user?.pin_hash) {
    return json({ ok: false, error: "Account not found." }, { status: 404 });
  }

  const token = randomToken(24);
  const ver = await sessionVersion(user.pin_hash);
  await env.SESSIONS.put(`sess:${token}`, JSON.stringify({ userID, ver }), {
    expirationTtl: 60 * 60 * 24 * 7,
  });

  return json(
    {
      ok: true,
      authenticated: true,
      userID,
      username: userID,
      createdAt: user.created_at || null,
      passwordUpdatedAt: user.updated_at || null,
      ...extra,
    },
    { headers: { "Set-Cookie": sessionCookie(token) } }
  );
}

/**
 * Replace a user's recovery codes with a fresh set.
 *
 * Returns the plaintext codes for this one response. On failure it returns an
 * empty list rather than throwing: a backup-code problem must not fail the
 * registration that already succeeded. The account simply has no codes, which
 * the UI reports honestly.
 */
async function issueRecoveryCodes(env, userID) {
  try {
    const codes = generateRecoveryCodes();
    const rows = await buildRecoveryCodeRows(userID, codes);
    if (!rows.length) return [];

    const insert = env.DB.prepare(
      "INSERT INTO recovery_codes (id, user_id, code_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const statements = [
      env.DB.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(userID),
      ...rows.map((row) =>
        insert.bind(row.id, row.userID, row.codeHash, row.salt, row.createdAt)
      ),
    ];
    await env.DB.batch(statements);
    return codes;
  } catch {
    return [];
  }
}

async function verifyTurnstile({ secret, siteKey, token, ip }) {
  const secretSet = !!secret;
  const siteKeySet = !!siteKey;

  // Turnstile is optional, but a half-configured deployment must fail closed.
  // The old check returned true whenever only the secret was missing, even
  // while the site key still made the UI demand a challenge.
  if (!secretSet && !siteKeySet) return true;
  if (!secretSet || !siteKeySet) return false;
  if (!token) return false;

  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (ip) form.set("remoteip", ip);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.success;
  } catch {
    return false;
  }
}
