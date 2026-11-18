import { json, readJson, sanitizeLedgerPayload, guardJsonMutation } from "../../_lib/common.js";
import { requireSession, ledgerOwnerMismatch } from "../../_lib/auth.js";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHS_PER_WRITE = 600;

export async function onRequestGet(context) {
  const session = await requireSession(context);
  if (!session) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const ownerMismatch = ledgerOwnerMismatch(context.request, session);
  if (ownerMismatch) return ownerMismatch;

  const userID = session.userID;
  const rows = await context.env.DB.prepare(
    "SELECT month, salary, items_json, paid_json, version FROM months WHERE user_id = ? ORDER BY month"
  )
    .bind(userID)
    .all();

  const map = {};
  const versions = {};
  for (const r of rows.results || []) {
    map[r.month] = {
      salary: r.salary ?? "",
      items: safeParse(r.items_json, {}),
      paid: safeParse(r.paid_json, {}),
    };
    versions[r.month] = r.version ?? 1;
  }
  return json({ ok: true, data: map, versions });
}

/**
 * Full-ledger write.
 *
 * This is the one-time migration route (a browser's local ledger moving into a
 * new account), not the normal save path: normal saves use the month route,
 * which carries a version. It stays unconditional on purpose, but it does bump
 * `version` so a client that later switches to conditional writes starts from
 * the value the server actually has.
 */
export async function onRequestPost(context) {
  const rejected = guardJsonMutation(context.request);
  if (rejected) return rejected;

  const session = await requireSession(context);
  if (!session) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const ownerMismatch = ledgerOwnerMismatch(context.request, session);
  if (ownerMismatch) return ownerMismatch;

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
      `INSERT INTO months (user_id, month, salary, items_json, paid_json, version, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(user_id, month) DO UPDATE SET
         salary = excluded.salary,
         items_json = excluded.items_json,
         paid_json = excluded.paid_json,
         version = months.version + 1,
         updated_at = excluded.updated_at`
    )
      .bind(userID, month, clean.salary, JSON.stringify(clean.items), JSON.stringify(clean.paid), Date.now())
      .run();
    written += 1;
  }

  const versions = {};
  if (written > 0) {
    const rows = await context.env.DB.prepare(
      "SELECT month, version FROM months WHERE user_id = ?"
    )
      .bind(userID)
      .all();
    for (const r of rows.results || []) versions[r.month] = r.version ?? 1;
  }

  return json({ ok: true, migrated: written, versions });
}

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
