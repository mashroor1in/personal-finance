import { json, readJson, randomToken, sessionCookie, sha256Hex, parseCookies, guardJsonMutation } from "../../_lib/common.js";
import { requireSession, sessionVersion } from "../../_lib/auth.js";

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

  if (!["register", "login", "changepassword", "resetaccount"].includes(mode)) {
    return json({ ok: false, error: "Invalid auth mode." }, { status: 400 });
  }

  const badPassword = () => json({ ok: false, error: "Password must be at least 6 characters." }, { status: 400 });
  const isPublicAuthMode = mode === "register" || mode === "login";

  if (isPublicAuthMode) {
    const lock = await reserveCredentialAttempt(env, clientIP);
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

    const salt = randomToken(16);
    const passwordHash = await sha256Hex(`${salt}:${password}`);
    await env.DB.prepare("INSERT INTO users (id, salt, pin_hash, updated_at) VALUES (?, ?, ?, ?)")
      .bind(username, salt, passwordHash, Date.now())
      .run();

    // Pre-account data (`user_id = 'default'`) is deliberately never handed to
    // the next person who registers. Public registration cannot prove
    // ownership of those rows, and auto-transferring them let an unauthenticated
    // visitor seed data that the first real account then inherited. Legacy rows
    // stay in place until an explicit, authenticated claim exists.

    // A successful registration proves the caller is not guessing at an
    // existing credential. It releases only the slot this request reserved;
    // the aggregate rate bucket is never reset by success.
    await releaseAuthFailure(env, clientIP);
    return await issueSessionAndRespond(env, username);
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

    const given = await sha256Hex(`${user.salt}:${password}`);
    if (given !== user.pin_hash) {
      return json({ ok: false, error: "Invalid username or password." }, { status: 401 });
    }

    await releaseAuthFailure(env, clientIP);
    return await issueSessionAndRespond(env, user.id);
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

    const currentHash = await sha256Hex(`${user.salt}:${currentPassword}`);
    if (currentHash !== user.pin_hash) {
      return json({ ok: false, error: "Current password is incorrect." }, { status: 401 });
    }

    const newSalt = randomToken(16);
    const newHash = await sha256Hex(`${newSalt}:${password}`);
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

    const given = await sha256Hex(`${user.salt}:${password}`);
    if (given !== user.pin_hash) {
      return json({ ok: false, error: "Current password is incorrect." }, { status: 401 });
    }

    await env.DB.prepare("DELETE FROM months WHERE user_id = ?").bind(userID).run();
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userID).run();

    const token = parseCookies(request).pf_session;
    if (token) {
      await env.SESSIONS.delete(`sess:${token}`);
    }

    await releaseAuthFailure(env, clientIP);
    return json(
      { ok: true, reset: true, message: "Account deleted. Create a new account." },
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

async function issueSessionAndRespond(env, userID) {
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
    },
    { headers: { "Set-Cookie": sessionCookie(token) } }
  );
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

// Atomic D1 throttling. KV's get-then-put let a parallel burst all read the
// same counter, so every in-flight request could reach the password digest
// before the sixth wrote a lock. D1's conditional upsert serialises the
// reservation, and the aggregate rate bucket is never reset by a success.
const AUTH_FAIL_LIMIT = 5;
const AUTH_RATE_LIMIT = 30;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LOCK_BASE_MS = 5 * 60 * 1000;
const AUTH_LOCK_MAX_MS = 60 * 60 * 1000;
const AUTH_RATE_LOCK_MAX_MS = 15 * 60 * 1000;

function authFailureKey(ip) {
  return `authfail:ip:${toSafeKey(ip || "unknown")}`;
}

function authRateKey(ip) {
  return `authrate:ip:${toSafeKey(ip || "unknown")}`;
}

async function reserveCredentialAttempt(env, ip) {
  const rate = await reserveAttempt(env, authRateKey(ip), AUTH_RATE_LIMIT, AUTH_RATE_LOCK_MAX_MS);
  if (rate.blocked) return rate;
  return reserveAttempt(env, authFailureKey(ip), AUTH_FAIL_LIMIT, AUTH_LOCK_MAX_MS);
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

async function releaseAuthFailure(env, ip) {
  try {
    await env.DB.prepare(
      "UPDATE auth_throttle SET count = MAX(count - 1, 0) WHERE key = ? AND lock_until <= ?"
    )
      .bind(authFailureKey(ip), Date.now())
      .run();
  } catch {
    // A cleanup failure must not turn a correct credential into a 500.
  }
}

function tooManyAttempts(lock) {
  return json(
    { ok: false, error: `Too many attempts. Try again in ${lock.retryAfterSeconds}s.` },
    { status: 429, headers: { "Retry-After": String(lock.retryAfterSeconds) } }
  );
}

function toSafeKey(input) {
  return String(input || "unknown").toLowerCase().replace(/[^a-z0-9._:-]/g, "_").slice(0, 120);
}
