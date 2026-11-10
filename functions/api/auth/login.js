import { json, readJson, randomToken, sessionCookie, sha256Hex, parseCookies } from "../../_lib/common.js";
import { requireSession, sessionVersion } from "../../_lib/auth.js";

export async function onRequestPost(context) {
  const { env, request } = context;
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
    const lock = await getActiveAuthLock(env, clientIP, username);
    if (lock.active) {
      return json(
        { ok: false, error: `Too many attempts. Try again in ${lock.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(lock.retryAfterSeconds) } }
      );
    }
  }

  if (mode === "register" || mode === "login") {
    const turnstileValid = await verifyTurnstile({
      secret: env.TURNSTILE_SECRET,
      token: turnstileToken,
      ip: request.headers.get("CF-Connecting-IP") || "",
    });
    if (!turnstileValid) {
      await recordAuthFailure(env, clientIP, username);
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

    await clearAuthFailures(env, clientIP, username);
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
      await recordAuthFailure(env, clientIP, username);
      return json({ ok: false, error: "Invalid username or password." }, { status: 401 });
    }

    const given = await sha256Hex(`${user.salt}:${password}`);
    if (given !== user.pin_hash) {
      await recordAuthFailure(env, clientIP, username);
      return json({ ok: false, error: "Invalid username or password." }, { status: 401 });
    }

    await clearAuthFailures(env, clientIP, username);
    return await issueSessionAndRespond(env, user.id);
  }

  const session = await requireSession(context);
  if (!session?.userID) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

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

async function verifyTurnstile({ secret, token, ip }) {
  if (!secret) return true;
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

const AUTH_FAIL_THRESHOLD = 5;
const AUTH_LOCK_BASE_MS = 5 * 60 * 1000;
const AUTH_LOCK_MAX_MS = 60 * 60 * 1000;
const AUTH_FAIL_TTL_SECONDS = 24 * 60 * 60;

async function getActiveAuthLock(env, ip, username) {
  const now = Date.now();
  let lockUntil = 0;

  for (const key of authFailKeys(ip, username)) {
    const state = await readFailState(env, key);
    lockUntil = Math.max(lockUntil, Number(state.lockUntil || 0));
  }

  if (lockUntil > now) {
    return {
      active: true,
      retryAfterSeconds: Math.max(1, Math.ceil((lockUntil - now) / 1000)),
    };
  }

  return { active: false, retryAfterSeconds: 0 };
}

async function recordAuthFailure(env, ip, username) {
  const now = Date.now();

  for (const key of authFailKeys(ip, username)) {
    const state = await readFailState(env, key);
    const fails = Number(state.fails || 0) + 1;

    let lockUntil = Number(state.lockUntil || 0);
    if (fails >= AUTH_FAIL_THRESHOLD) {
      const exponent = Math.max(0, fails - AUTH_FAIL_THRESHOLD);
      const lockMs = Math.min(AUTH_LOCK_BASE_MS * (2 ** exponent), AUTH_LOCK_MAX_MS);
      lockUntil = Math.max(lockUntil, now + lockMs);
    }

    await env.SESSIONS.put(
      key,
      JSON.stringify({ fails, lockUntil, updatedAt: now }),
      { expirationTtl: AUTH_FAIL_TTL_SECONDS }
    );
  }
}

async function clearAuthFailures(env, ip, username) {
  for (const key of authFailKeys(ip, username)) {
    await env.SESSIONS.delete(key);
  }
}

async function readFailState(env, key) {
  try {
    const raw = await env.SESSIONS.get(key);
    if (!raw) return { fails: 0, lockUntil: 0 };
    const parsed = JSON.parse(raw);
    return {
      fails: Number(parsed?.fails || 0),
      lockUntil: Number(parsed?.lockUntil || 0),
    };
  } catch {
    return { fails: 0, lockUntil: 0 };
  }
}

function authFailKeys(ip, username) {
  const safeIP = toSafeKey(ip || "unknown");
  const keys = [`authfail:ip:${safeIP}`];

  if (isValidUsername(username)) {
    keys.push(`authfail:user:${toSafeKey(username)}`);
  }

  return keys;
}

function toSafeKey(input) {
  return String(input || "unknown").toLowerCase().replace(/[^a-z0-9._:-]/g, "_").slice(0, 120);
}
