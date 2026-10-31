import { json } from "../../_lib/common.js";

export async function onRequestGet(context) {
  const row = await context.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind("default").first();
  return json({ ok: true, hasPin: !!row });
}
