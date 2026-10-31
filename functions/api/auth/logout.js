import { json, parseCookies, sessionCookie } from "../../_lib/common.js";

export async function onRequestPost(context) {
  const cookies = parseCookies(context.request);
  const token = cookies.pf_session;
  if (token) {
    await context.env.SESSIONS.delete(`sess:${token}`);
  }
  return json({ ok: true }, { headers: { "Set-Cookie": sessionCookie("") } });
}
