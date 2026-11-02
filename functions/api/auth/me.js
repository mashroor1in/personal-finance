import { json } from "../../_lib/common.js";
import { requireSession } from "../../_lib/auth.js";

export async function onRequestGet(context) {
  const session = await requireSession(context);
  if (!session) return json({ ok: false, authenticated: false }, { status: 401 });

  const row = await context.env.DB.prepare("SELECT id, created_at, updated_at FROM users WHERE id = ?")
    .bind(session.userID)
    .first();

  if (!row) return json({ ok: false, authenticated: false }, { status: 401 });

  return json({
    ok: true,
    authenticated: true,
    userID: row.id,
    username: row.id,
    createdAt: row.created_at || null,
    passwordUpdatedAt: row.updated_at || null,
  });
}
