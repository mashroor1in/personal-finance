import { json, readJson, sanitizeLedgerPayload, guardJsonMutation } from "../../../_lib/common.js";
import { requireSession } from "../../../_lib/auth.js";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function onRequestPut(context) {
  const rejected = guardJsonMutation(context.request);
  if (rejected) return rejected;

  const session = await requireSession(context);
  if (!session) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const month = context.params.month;
  if (!MONTH_RE.test(month || "")) {
    return json({ ok: false, error: "Invalid month format" }, { status: 400 });
  }

  const body = await readJson(context.request);
  const userID = session.userID;
  const clean = sanitizeLedgerPayload(body);

  await context.env.DB.prepare(
    `INSERT INTO months (user_id, month, salary, items_json, paid_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, month) DO UPDATE SET
       salary = excluded.salary,
       items_json = excluded.items_json,
       paid_json = excluded.paid_json,
       updated_at = excluded.updated_at`
  )
    .bind(userID, month, clean.salary, JSON.stringify(clean.items), JSON.stringify(clean.paid), Date.now())
    .run();

  return json({ ok: true, month });
}

export async function onRequestGet(context) {
  const session = await requireSession(context);
  if (!session) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const month = context.params.month;
  if (!MONTH_RE.test(month || "")) {
    return json({ ok: false, error: "Invalid month format" }, { status: 400 });
  }

  const row = await context.env.DB.prepare(
    "SELECT salary, items_json, paid_json FROM months WHERE user_id = ? AND month = ?"
  )
    .bind(session.userID, month)
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
