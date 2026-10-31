import { json, readJson, randomToken, sessionCookie, sha256Hex, parseCookies } from "../../_lib/common.js";
import { requireSession } from "../../_lib/auth.js";

export async function onRequestPost(context) {
  const { env, request } = context;
  const body = await readJson(request);
  const mode = String(body.mode || "login").trim();
  const username = normalizeUsername(body.username);
  const password = String(body.password || "").trim();
  const currentPassword = String(body.currentPassword || "").trim();
  const confirmPassword = String(body.confirmPassword || "").trim();
  const resetConfirm = String(body.resetConfirm || "").trim();

  if (!["register", "login", "changepassword", "resetaccount"].includes(mode)) {
    return json({ ok: false, error: "Invalid auth mode." }, { status: 400 });
  }

  const badPassword = () => json({ ok: false, error: "Password must be at least 6 characters." }, { status: 400 });

  if (mode === "register") {
    if (!isValidUsername(username)) {
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

    const usersCountRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM users WHERE id != 'default'").first();
    const hadNoRealUsers = Number(usersCountRow?.c || 0) === 0;

    const salt = randomToken(16);
    const passwordHash = await sha256Hex(`${salt}:${password}`);
    await env.DB.prepare("INSERT INTO users (id, salt, pin_hash, updated_at) VALUES (?, ?, ?, ?)")
      .bind(username, salt, passwordHash, Date.now())
      .run();

    if (hadNoRealUsers) {
      await env.DB.prepare(
        `INSERT INTO months (user_id, month, salary, items_json, paid_json, updated_at, created_at)
         SELECT ?, month, salary, items_json, paid_json, updated_at, created_at
         FROM months
         WHERE user_id = 'default'
         ON CONFLICT(user_id, month) DO NOTHING`
      )
        .bind(username)
        .run();

      await env.DB.prepare("DELETE FROM months WHERE user_id = 'default'").run();
      await env.DB.prepare("DELETE FROM users WHERE id = 'default'").run();
    }

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
    if (!user) return json({ ok: false, error: "Invalid username or password." }, { status: 401 });

    const given = await sha256Hex(`${user.salt}:${password}`);
    if (given !== user.pin_hash) {
      return json({ ok: false, error: "Invalid username or password." }, { status: 401 });
    }

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
      return json({ ok: false, error: "Type DELETE to confirm reset." }, { status: 400 });
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
      { ok: true, reset: true, message: "Account reset complete. Create a new account." },
      { headers: { "Set-Cookie": sessionCookie("") } }
    );
  }

  return json({ ok: false, error: "Unsupported mode." }, { status: 400 });
}

function normalizeUsername(input) {
  return String(input || "").trim().toLowerCase();
}

function isValidUsername(username) {
  return /^[a-z0-9._-]{3,32}$/.test(username);
}

async function issueSessionAndRespond(env, userID) {
  const token = randomToken(24);
  await env.SESSIONS.put(`sess:${token}`, JSON.stringify({ userID }), { expirationTtl: 60 * 60 * 24 * 7 });

  const updated = await env.DB.prepare("SELECT updated_at FROM users WHERE id = ?").bind(userID).first();
  return json(
    { ok: true, authenticated: true, userID, username: userID, passwordUpdatedAt: updated?.updated_at || null },
    { headers: { "Set-Cookie": sessionCookie(token) } }
  );
}
