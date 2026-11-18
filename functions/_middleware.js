/**
 * Host allowlist for the app and its API.
 *
 * There is no Cloudflare Access in front of this project, so every hostname
 * that points at the Pages project can reach the same app. The project's
 * production alias (`personal-finance-8ch.pages.dev`) is therefore a second,
 * publicly reachable copy of the real thing.
 *
 * The rule is a closed list:
 *
 *   bucksy.life, www.bucksy.life        canonical domains
 *   localhost, 127.0.0.1, [::1]         local `wrangler pages dev`
 *   *.<project>.pages.dev               preview deployments
 *
 * Everything else gets a 404. `personal-finance-8ch.pages.dev` is explicitly
 * denied even though it matches `.pages.dev`: it is the production alias, not
 * a preview.
 *
 * This file only runs for the paths listed in `_routes.json` (`/api/*` and
 * `/app`), so static files never invoke a Function just to be served.
 */

const CANONICAL_HOSTS = new Set(["bucksy.life", "www.bucksy.life"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PREVIEW_SUFFIX = ".personal-finance.pages.dev";
const PRODUCTION_ALIAS = "personal-finance-8ch.pages.dev";

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Page not found — Bucksy</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    padding: 24px; background: #F9F6EE; color: #102F27;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 34rem; text-align: center; }
  img { width: 52px; height: auto; margin-bottom: 20px; }
  .eyebrow {
    margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .16em;
    text-transform: uppercase; color: #18815A;
  }
  h1 { margin: 0 0 12px; font-size: clamp(28px, 6vw, 40px); line-height: 1.1; letter-spacing: -.02em; }
  p { margin: 0 0 24px; color: #566F62; line-height: 1.6; }
  a {
    display: inline-block; padding: 12px 20px; border-radius: 999px;
    background: #0B3D2E; color: #F9F6EE; font-weight: 600; text-decoration: none;
  }
  a:hover { background: #18815A; }
</style>
</head>
<body>
<main>
  <img src="/assets/mark.svg" alt="" width="52" height="58">
  <p class="eyebrow">404</p>
  <h1>This page is not here.</h1>
  <p>The address may be mistyped, or this host is not the one Bucksy is served from. The planner lives at bucksy.life.</p>
  <a href="https://bucksy.life/">Go to bucksy.life</a>
</main>
</body>
</html>`;

/** Drop a `:port` suffix, keeping IPv6 literals such as `[::1]` intact. */
function stripPort(host) {
  const value = String(host || "").trim();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(0, end + 1);
  }
  return value.split(":")[0];
}

/** True when `hostname` is allowed to reach the app or its API. */
export function isAllowedHost(hostname) {
  const host = stripPort(hostname).toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  if (CANONICAL_HOSTS.has(host) || LOCAL_HOSTS.has(host)) return true;
  if (host === PRODUCTION_ALIAS) return false;
  return host.endsWith(PREVIEW_SUFFIX);
}

/**
 * The public hostname. `Host` is what the browser asked for; `request.url` is
 * the fallback for environments that do not expose it (and for tests).
 */
function requestHost(request) {
  const header = request.headers.get("host");
  if (header) return header;
  try {
    return new URL(request.url).hostname;
  } catch {
    return "";
  }
}

const BASE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function jsonNotFound() {
  return new Response(JSON.stringify({ ok: false, error: "Not found" }), {
    status: 404,
    headers: {
      ...BASE_HEADERS,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export async function onRequest(context) {
  let pathname = "";
  try {
    pathname = new URL(context.request.url).pathname;
  } catch {
    return jsonNotFound();
  }

  if (isAllowedHost(requestHost(context.request))) return context.next();

  if (pathname.startsWith("/api/")) return jsonNotFound();

  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      ...BASE_HEADERS,
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex",
    },
  });
}
