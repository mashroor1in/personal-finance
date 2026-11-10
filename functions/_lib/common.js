export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    let v = part.slice(idx + 1).trim();
    try {
      v = decodeURIComponent(v);
    } catch {
      // A malformed percent-escape must not turn the whole request into a 500.
    }
    if (k) out[k] = v;
  }
  return out;
}

export function randomToken(bytes = 24) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function sessionCookie(token = "", maxAge = 60 * 60 * 24 * 7) {
  const secure = "Secure; HttpOnly; SameSite=Lax";
  if (!token) return `pf_session=; Path=/; Max-Age=0; ${secure}`;
  return `pf_session=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; ${secure}`;
}

const ITEM_KEY_RE = /^[a-z0-9._-]{1,64}$/i;
const MAX_ITEMS_PER_MONTH = 500;

/** Keep stored keys as inert data, never inherited-object machinery. */
function isSafeItemKey(key) {
  if (!ITEM_KEY_RE.test(key)) return false;
  const lowered = key.toLowerCase();
  return lowered !== "__proto__" && lowered !== "prototype" && lowered !== "constructor";
}

/**
 * Reduce a client-supplied month record to the stored shape.
 *
 * Amounts must be finite numbers (or "" for cleared), keys must look like item
 * keys, and the item count is capped. This is the server-side half of the XSS
 * fix: markup or object payloads can never reach `items_json`/`paid_json`, so a
 * future renderer regression still cannot read attacker HTML from the API.
 */
export function sanitizeLedgerPayload(value) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  const salaryRaw = record.salary;
  const salaryBlank = salaryRaw == null || (typeof salaryRaw === "string" && salaryRaw.trim() === "");
  const salaryNum = Number(salaryRaw);
  const salary = salaryBlank ? null : (Number.isFinite(salaryNum) ? salaryNum : null);

  const items = {};
  const rawItems = record.items && typeof record.items === "object" && !Array.isArray(record.items)
    ? record.items
    : {};
  let count = 0;
  for (const [key, raw] of Object.entries(rawItems)) {
    if (count >= MAX_ITEMS_PER_MONTH) break;
    if (!isSafeItemKey(key)) continue;
    if (raw === "" || raw == null) {
      items[key] = "";
      count += 1;
      continue;
    }
    const num = Number(raw);
    if (Number.isFinite(num)) {
      items[key] = num;
      count += 1;
    }
  }

  const paid = {};
  const rawPaid = record.paid && typeof record.paid === "object" && !Array.isArray(record.paid)
    ? record.paid
    : {};
  count = 0;
  for (const [key, raw] of Object.entries(rawPaid)) {
    if (count >= MAX_ITEMS_PER_MONTH) break;
    if (!isSafeItemKey(key)) continue;
    paid[key] = !!raw;
    count += 1;
  }

  return { salary, items, paid };
}
