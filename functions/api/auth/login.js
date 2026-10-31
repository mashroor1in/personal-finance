import { json, readJson, randomToken, sessionCookie, sha256Hex } from "../../_lib/common.js";

export async function onRequestPost(context) {
  const { env, request } = context;
  const body = await readJson(request);
  const mode = body.mode || "login";
  const pin = String(body.pin || "").trim();
  const currentPin = String(body.currentPin || "").trim();
  const confirmPin = String(body.confirmPin || "").trim();
  const resetConfirm = String(body.resetConfirm || "").trim();
  const userID = "default";

  const user = await env.DB.prepare("SELECT id, salt, pin_hash, updated_at FROM users WHERE id = ?").bind(userID).first();

  if (!["setup", "login", "changepin", "reset"].includes(mode)) {
    return json({ ok: false, error: "Invalid auth mode." }, { status: 400 });
  }

  const badPin = () => json({ ok: false, error: "PIN must be at least 4 digits." }, { status: 400 });
  if ((mode === "setup" || mode === "login" || mode === "reset") && !/^\d{4,}$/.test(pin)) {
    return badPin();
  }

  if (mode === "setup") {
    if (user) return json({ ok: false, error: "PIN already set." }, { status: 409 });
    if (pin !== confirmPin) return json({ ok: false, error: "PIN confirmation does not match." }, { status: 400 });
    const salt = randomToken(16);
    const pinHash = await sha256Hex(`${salt}:${pin}`);
    await env.DB.prepare("INSERT INTO users (id, salt, pin_hash, updated_at) VALUES (?, ?, ?, ?)")
      .bind(userID, salt, pinHash, Date.now())
      .run();
  } else if (mode === "login") {
    if (!user) return json({ ok: false, error: "PIN not set. Run setup first." }, { status: 400 });
    const given = await sha256Hex(`${user.salt}:${pin}`);
    if (given !== user.pin_hash) return json({ ok: false, error: "Incorrect PIN." }, { status: 401 });
  } else if (mode === "changepin") {
    if (!user) return json({ ok: false, error: "PIN not set. Run setup first." }, { status: 400 });
    if (!/^\d{4,}$/.test(currentPin)) return json({ ok: false, error: "Current PIN is required." }, { status: 400 });
    if (!/^\d{4,}$/.test(pin)) return badPin();
    if (!/^\d{4,}$/.test(confirmPin) || pin !== confirmPin) {
      return json({ ok: false, error: "New PIN confirmation does not match." }, { status: 400 });
    }
    const currentHash = await sha256Hex(`${user.salt}:${currentPin}`);
    if (currentHash !== user.pin_hash) return json({ ok: false, error: "Current PIN is incorrect." }, { status: 401 });
    const newSalt = randomToken(16);
    const newHash = await sha256Hex(`${newSalt}:${pin}`);
    await env.DB.prepare("UPDATE users SET salt = ?, pin_hash = ?, updated_at = ? WHERE id = ?")
      .bind(newSalt, newHash, Date.now(), userID)
      .run();
  } else if (mode === "reset") {
    if (!user) return json({ ok: false, error: "PIN not set. Run setup first." }, { status: 400 });
    const given = await sha256Hex(`${user.salt}:${pin}`);
    if (given !== user.pin_hash) return json({ ok: false, error: "Incorrect PIN." }, { status: 401 });
    if (resetConfirm !== "DELETE") {
      return json({ ok: false, error: "Type DELETE to confirm reset." }, { status: 400 });
    }
    await env.DB.prepare("DELETE FROM months WHERE user_id = ?").bind(userID).run();
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userID).run();
    return json(
      { ok: true, reset: true, message: "Planner reset. Set up a new PIN." },
      { headers: { "Set-Cookie": sessionCookie("") } }
    );
  }

  const token = randomToken(24);
  await env.SESSIONS.put(`sess:${token}`, JSON.stringify({ userID }), { expirationTtl: 60 * 60 * 24 * 7 });

  const updated = await env.DB.prepare("SELECT updated_at FROM users WHERE id = ?").bind(userID).first();
  return json(
    { ok: true, authenticated: true, userID, pinUpdatedAt: updated?.updated_at || null },
    { headers: { "Set-Cookie": sessionCookie(token) } }
  );
}
