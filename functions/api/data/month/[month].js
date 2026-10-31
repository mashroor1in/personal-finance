import { json, readJson } from "../../../_lib/common.js";
import { requireSession } from "../../../_lib/auth.js";

export async function onRequestPut(context) {
  const session = await requireSession(context);
  if (!session) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const month = context.params.month;
  if (!/^\d{4}-\d{2}$/.test(month || "")) {
    return json({ ok: false, error: "Invalid month format" }, { status: 400 });
  }

  const body = await readJson(context.request);
  const userID = session.userID || "default";
  const salaryRaw = body?.salary;
  const salaryNum = Number(salaryRaw);
  const salary = salaryRaw === "" || salaryRaw == null ? null : (Number.isFinite(salaryNum) ? salaryNum : null);
  const items = body?.items || {};
  const paid = body?.paid || {};

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

  return json({ ok: true, month });
}

export async function onRequestGet(context) {
  const session = await requireSession(context);
  if (!session) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const month = context.params.month;
  if (!/^\d{4}-\d{2}$/.test(month || "")) {
    return json({ ok: false, error: "Invalid month format" }, { status: 400 });
  }

  const row = await context.env.DB.prepare(
    "SELECT salary, items_json, paid_json FROM months WHERE user_id = ? AND month = ?"
  )
    .bind(session.userID || "default", month)
    .first();

  if (!row) return json({ ok: true, month, data: null });

  return json({
    ok: true,
    month,
    data: {
      salary: row.salary ?? "",
      items: safeParse(row.items_json, {}),
      paid: safeParse(row.paid_json, {}),
    },
  });
}

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
