import { parseCookies } from "./common.js";

export async function requireSession(context) {
  const { request, env } = context;
  const cookies = parseCookies(request);
  const token = cookies.pf_session;
  if (!token) return null;
  const key = `sess:${token}`;
  const raw = await env.SESSIONS.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
