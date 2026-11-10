import { parseCookies, sha256Hex } from "./common.js";

/**
 * Resolve the presented session cookie to a live account.
 *
 * A token is only valid while the users row still exists *and* the account's
 * password verifier is unchanged. That makes password changes, account
 * deletion, and username re-registration invalidate every token issued under
 * the old credential instead of leaving it usable for the KV TTL.
 */
export async function requireSession(context) {
  const { request, env } = context;
  const cookies = parseCookies(request);
  const token = cookies.pf_session;
  if (!token) return null;

  const raw = await env.SESSIONS.get(`sess:${token}`);
  if (!raw) return null;

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!session?.userID || typeof session.ver !== "string" || !session.ver) return null;

  const user = await env.DB.prepare("SELECT pin_hash FROM users WHERE id = ?")
    .bind(session.userID)
    .first();
  if (!user?.pin_hash) return null;

  const ver = await sha256Hex(`session:${user.pin_hash}`);
  return ver === session.ver ? session : null;
}

/** The credential version stored in a session record for one password hash. */
export async function sessionVersion(pinHash) {
  return sha256Hex(`session:${pinHash}`);
}
