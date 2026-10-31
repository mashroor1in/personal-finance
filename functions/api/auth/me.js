import { json } from "../../_lib/common.js";
import { requireSession } from "../../_lib/auth.js";

export async function onRequestGet(context) {
  const session = await requireSession(context);
  if (!session) return json({ ok: false, authenticated: false }, { status: 401 });

  const row = await context.env.DB.prepare("SELECT updated_at FROM users WHERE id = ?")
    .bind(session.userID || "default")
    .first();

  return json({
    ok: true,
    authenticated: true,
    userID: session.userID || "default",
    pinUpdatedAt: row?.updated_at || null,
  });
}
