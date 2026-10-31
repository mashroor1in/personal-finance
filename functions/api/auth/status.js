import { json } from "../../_lib/common.js";

export async function onRequestGet(context) {
  const users = await context.env.DB.prepare("SELECT COUNT(*) AS c FROM users WHERE id != 'default'").first();
  const legacy = await context.env.DB.prepare("SELECT id FROM users WHERE id = 'default'").first();
  return json({ ok: true, hasUsers: Number(users?.c || 0) > 0, hasLegacyDefault: !!legacy });
}
