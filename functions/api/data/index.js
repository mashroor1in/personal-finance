import { json, readJson } from "../../_lib/common.js";
import { requireSession } from "../../_lib/auth.js";

export async function onRequestGet(context) {
  const session = await requireSession(context);
  if (!session) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const userID = session.userID;
  const rows = await context.env.DB.prepare(
    "SELECT month, salary, items_json, paid_json FROM months WHERE user_id = ? ORDER BY month"
  )
    .bind(userID)
    .all();

  const map = {};
  for (const r of rows.results || []) {
    map[r.month] = {
      salary: r.salary ?? "",
      items: safeParse(r.items_json, {}),
      paid: safeParse(r.paid_json, {}),
    };
  }
  return json({ ok: true, data: map });
}

export async function onRequestPost(context) {
  const session = await requireSession(context);
  if (!session) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await readJson(context.request);
  const source = body?.data;
  if (!source || typeof source !== "object") {
    return json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const userID = session.userID;
  const entries = Object.entries(source);
  for (const [month, val] of entries) {
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const salaryRaw = val?.salary;
    const salaryNum = Number(salaryRaw);
    const salary = salaryRaw === "" || salaryRaw == null ? null : (Number.isFinite(salaryNum) ? salaryNum : null);
    const items = val?.items || {};
    const paid = val?.paid || {};
    await context.env.DB.prepare(
      `INSERT INTO months (user_id, month, salary, items_json, paid_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, month) DO UPDATE SET
         salary = excluded.salary,
         items_json = excluded.items_json,
         paid_json = excluded.paid_json,
         updated_at = excluded.updated_at`
    )
      .bind(userID, month, salary, JSON.stringify(items), JSON.stringify(paid), Date.now())
      .run();
  }

  return json({ ok: true, migrated: entries.length });
}

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
