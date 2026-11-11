/**
 * Retention window for a deleted account's planner data.
 *
 * Deleting an account closes it at once: the user row, its recovery codes and
 * every session go. Only the financial history is kept, in `deleted_months`,
 * for this long. After that it is gone for good.
 *
 * The window exists for one reason: an accidental deletion should not destroy
 * years of records. It is not a backup. See RUNBOOK.md for how to restore.
 */
export const DELETED_DATA_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The moment this deletion stops being recoverable. */
export function purgeAfterFrom(now = Date.now()) {
  return now + DELETED_DATA_RETENTION_DAYS * DAY_MS;
}

/**
 * Permanently erase trash whose month is up.
 *
 * Pages Functions have no cron trigger, so this rides along with sign-in
 * events instead of running on a schedule. On a dormant site the purge can
 * lag, which is harmless: the rows it removes are already past their promised
 * deletion date, and nothing reads them in the meantime.
 *
 * Never throws. A retention cleanup must not fail the login that triggered it,
 * and a deployment that has not applied migration 0004 simply has nothing to
 * purge.
 */
export async function purgeExpiredDeletedData(env, now = Date.now()) {
  try {
    const result = await env.DB.prepare("DELETE FROM deleted_months WHERE purge_after <= ?")
      .bind(now)
      .run();
    return Number(result?.meta?.changes || 0);
  } catch {
    return 0;
  }
}
