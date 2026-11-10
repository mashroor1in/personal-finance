import { json, readJson, sanitizeLedgerPayload } from "../../_lib/common.js";
import { requireSession } from "../../_lib/auth.js";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHS_PER_WRITE = 600;

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
  let written = 0;
  for (const [month, val] of entries) {
    if (written >= MAX_MONTHS_PER_WRITE) break;
    if (!MONTH_RE.test(month)) continue;
    const clean = sanitizeLedgerPayload(val);
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
    written += 1;
  }

  return json({ ok: true, migrated: written });
}

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
