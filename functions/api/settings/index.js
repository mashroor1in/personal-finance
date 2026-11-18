import {
  json,
  readJson,
  sanitizeSettingsPayload,
  guardJsonMutation,
} from "../../_lib/common.js";
import { requireSession, ledgerOwnerMismatch } from "../../_lib/auth.js";

/**
 * Account-level settings: the `__meta` block that used to be local-only.
 *
 * Same contract as a month write: the client sends the version it last saw,
 * and a stale write gets a 409 with the current copy instead of overwriting a
 * change made on another device. `baseVersion` is optional so a browser that
 * has never seen this endpoint can still seed the row.
 */

function readBaseVersion(body) {
  const raw = body?.baseVersion;
  return Number.isInteger(raw) && raw >= 0 ? raw : null;
}

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function currentRow(env, userID) {
  return env.DB.prepare(
    "SELECT json, version, updated_at FROM user_settings WHERE user_id = ?"
  )
    .bind(userID)
    .first();
}

export async function onRequestGet(context) {
  const session = await requireSession(context);
  if (!session) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const ownerMismatch = ledgerOwnerMismatch(context.request, session);
  if (ownerMismatch) return ownerMismatch;

  const row = await currentRow(context.env, session.userID);
  if (!row) {
    return json({ ok: true, settings: null, version: 0, updatedAt: null });
  }

  return json({
    ok: true,
    settings: safeParse(row.json, {}),
    version: row.version ?? 1,
    updatedAt: row.updated_at ?? null,
  });
}

export async function onRequestPut(context) {
  const rejected = guardJsonMutation(context.request);
  if (rejected) return rejected;

  const session = await requireSession(context);
  if (!session) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const ownerMismatch = ledgerOwnerMismatch(context.request, session);
  if (ownerMismatch) return ownerMismatch;

  const body = await readJson(context.request);
  const settings = sanitizeSettingsPayload(body?.settings ?? body);
  const serialized = JSON.stringify(settings);
  const baseVersion = readBaseVersion(body);
  const now = Date.now();
  const userID = session.userID;

  if (baseVersion === null) {
    await context.env.DB.prepare(
      `INSERT INTO user_settings (user_id, json, version, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         json = excluded.json,
         version = user_settings.version + 1,
         updated_at = excluded.updated_at`
    )
      .bind(userID, serialized, now)
      .run();
  } else {
    const result = await context.env.DB.prepare(
      `INSERT INTO user_settings (user_id, json, version, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         json = excluded.json,
         version = user_settings.version + 1,
         updated_at = excluded.updated_at
       WHERE user_settings.version = ?`
    )
      .bind(userID, serialized, now, baseVersion)
      .run();

    if (!result?.meta?.changes) {
      const current = await currentRow(context.env, userID);
      return json(
        {
          ok: false,
          code: "version_conflict",
          error: "Settings changed on another device.",
          version: current?.version ?? 0,
          settings: current ? safeParse(current.json, {}) : null,
        },
        { status: 409 }
      );
    }
  }

  const row = await currentRow(context.env, userID);
  return json({ ok: true, version: row?.version ?? 1, updatedAt: now });
}
