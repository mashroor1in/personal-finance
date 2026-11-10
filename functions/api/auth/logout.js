import { json, parseCookies, sessionCookie, guardJsonMutation } from "../../_lib/common.js";

export async function onRequestPost(context) {
  const rejected = guardJsonMutation(context.request);
  if (rejected) return rejected;

  const cookies = parseCookies(context.request);
  const token = cookies.pf_session;

  if (token) {
    // The browser credential is cleared below whether or not the KV delete
    // succeeds. A failed delete leaves the server-side record valid until its
    // TTL, but the response still ends this browser's session, so it must be a
    // successful logout that lets the client drop local state.
    try {
      await context.env.SESSIONS.delete(`sess:${token}`);
    } catch {
      // Best effort: the clearing cookie below still removes the client token.
    }
  }

  return json({ ok: true }, { headers: { "Set-Cookie": sessionCookie("") } });
}
