import { json, readJson, sanitizeLedgerPayload, guardJsonMutation } from "../../../_lib/common.js";
import { requireSession, ledgerOwnerMismatch } from "../../../_lib/auth.js";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function readBaseVersion(body) {
  const raw = body?.baseVersion;
  return Number.isInteger(raw) && raw >= 0 ? raw : null;
}

function toRecord(row) {
  return {
    salary: row.salary ?? "",
    items: safeParse(row.items_json, {}),
    paid: safeParse(row.paid_json, {}),
  };
}

export async function onRequestPut(context) {
  const rejected = guardJsonMutation(context.request);
  if (rejected) return rejected;

  const session = await requireSession(context);
  if (!session) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const ownerMismatch = ledgerOwnerMismatch(context.request, session);
  if (ownerMismatch) return ownerMismatch;

  const month = context.params.month;
  if (!MONTH_RE.test(month || "")) {
    return json({ ok: false, error: "Invalid month format" }, { status: 400 });
  }

  const body = await readJson(context.request);
  const userID = session.userID;
  const clean = sanitizeLedgerPayload(body);
  const baseVersion = readBaseVersion(body);
  const now = Date.now();

  // No `baseVersion` is the old client contract: overwrite. New clients always
  // send one, so this branch exists only for a cached page during rollout.
  if (baseVersion === null) {
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
      .bind(userID, month, clean.salary, JSON.stringify(clean.items), JSON.stringify(clean.paid), now)
      .run();

    const row = await context.env.DB.prepare(
      "SELECT version FROM months WHERE user_id = ? AND month = ?"
    )
      .bind(userID, month)
      .first();
    return json({ ok: true, month, version: row?.version ?? 1 });
  }

  const result = await context.env.DB.prepare(
    `INSERT INTO months (user_id, month, salary, items_json, paid_json, version, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(user_id, month) DO UPDATE SET
       salary = excluded.salary,
       items_json = excluded.items_json,
       paid_json = excluded.paid_json,
       version = months.version + 1,
       updated_at = excluded.updated_at
     WHERE months.version = ?`
  )
    .bind(
      userID,
      month,
      clean.salary,
      JSON.stringify(clean.items),
      JSON.stringify(clean.paid),
      now,
      baseVersion
    )
    .run();

  if (!result?.meta?.changes) {
    const current = await context.env.DB.prepare(
      "SELECT salary, items_json, paid_json, version FROM months WHERE user_id = ? AND month = ?"
    )
      .bind(userID, month)
      .first();

    return json(
      {
        ok: false,
        code: "version_conflict",
        error: "This month changed on another device.",
        month,
        version: current?.version ?? 0,
        current: current ? toRecord(current) : null,
      },
      { status: 409 }
    );
  }

  const row = await context.env.DB.prepare(
    "SELECT version FROM months WHERE user_id = ? AND month = ?"
  )
    .bind(userID, month)
    .first();

  return json({ ok: true, month, version: row?.version ?? baseVersion + 1 });
}

export async function onRequestGet(context) {
  const session = await requireSession(context);
  if (!session) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const ownerMismatch = ledgerOwnerMismatch(context.request, session);
  if (ownerMismatch) return ownerMismatch;

  const month = context.params.month;
  if (!MONTH_RE.test(month || "")) {
    return json({ ok: false, error: "Invalid month format" }, { status: 400 });
  }

  const row = await context.env.DB.prepare(
    "SELECT salary, items_json, paid_json, version FROM months WHERE user_id = ? AND month = ?"
  )
    .bind(session.userID, month)
    .first();

  if (!row) return json({ ok: true, month, data: null, version: 0 });

  return json({
    ok: true,
    month,
    data: toRecord(row),
    version: row.version ?? 1,
  });
}

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
