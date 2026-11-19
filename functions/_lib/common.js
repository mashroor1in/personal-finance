export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

/**
 * Mutating endpoints only accept a JSON body from their own origin.
 *
 * This blocks the cross-site `text/plain` form POST used for login CSRF: a
 * form cannot send `application/json`, and a cross-site fetch that tries is
 * stopped by the CORS preflight. Requests without an Origin header (server to
 * server, curl) remain usable, but still have to declare JSON.
 */
export function guardJsonMutation(request) {
  const origin = request.headers.get("origin");
  if (origin) {
    let expected = null;
    try {
      expected = new URL(request.url).origin;
    } catch {
      expected = null;
    }
    if (!expected || origin !== expected) {
      return json({ ok: false, error: "Cross-site request rejected." }, { status: 403 });
    }
  }

  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    return json({ ok: false, error: "Expected application/json." }, { status: 415 });
  }

  return null;
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

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * Both sides are hashed first so the compared arrays are always the same
 * length, and the loop never exits early.
 */
export async function constantTimeEqual(a, b) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(a ?? ""))),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(b ?? ""))),
  ]);
  return equalBytes(new Uint8Array(left), new Uint8Array(right));
}

function equalBytes(left, right) {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }
  return diff === 0;
}

/*
 * Password verifiers.
 *
 * The original format was a single SHA-256 over `salt:password`, which a GPU
 * can walk billions of times per second after a database dump. New verifiers
 * use PBKDF2-HMAC-SHA256 and record their own parameters, so the published
 * iteration count can move without rewriting every row:
 *
 *   pbkdf2-sha256$<iterations>$<salt base64>$<derived key base64>
 *
 * Existing rows keep working: `verifyPassword` recognises the legacy 64-hex
 * value and the caller rewrites it after a successful login. The stored
 * iteration count is always honoured, even if the policy below is raised or
 * lowered later.
 */
const PASSWORD_SCHEME = "pbkdf2-sha256";
const PASSWORD_KEY_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;

/**
 * Cloudflare's WebCrypto refuses any PBKDF2 request above this many
 * iterations, throwing `NotSupportedError`. That is a hard platform ceiling,
 * not a tuning knob: asking for more than 100000 turns every login into a 500.
 */
export const MAX_PBKDF2_ITERATIONS = 100000;
const MIN_PBKDF2_ITERATIONS = 1000;

/**
 * New verifiers use this many iterations. Verification reads the count from
 * each stored record, so raising the policy upgrades accounts on their next
 * successful login instead of requiring a data migration.
 *
 * Defaults to the platform ceiling. `PASSWORD_ITERATIONS` may only lower it;
 * higher values are clamped rather than passed through, because exceeding the
 * ceiling throws instead of degrading.
 */
export const PASSWORD_ITERATIONS = MAX_PBKDF2_ITERATIONS;

function resolveIterations(env) {
  const configured = Number(env?.PASSWORD_ITERATIONS);
  if (Number.isInteger(configured) && configured >= MIN_PBKDF2_ITERATIONS) {
    return Math.min(configured, MAX_PBKDF2_ITERATIONS);
  }
  return PASSWORD_ITERATIONS;
}

/** A fresh verifier plus the salt to keep in the legacy `salt` column. */
export async function hashPassword(password, env) {
  const iterations = resolveIterations(env);
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const key = await derivePasswordKey(password, salt, iterations);
  return {
    salt: bytesToBase64(salt),
    pinHash: `${PASSWORD_SCHEME}$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(key)}`,
  };
}

/**
 * Check a password against a stored user row.
 *
 * Returns `{ ok, needsRehash }`. `needsRehash` is only true for a correct
 * legacy (or weaker-parameter) verifier, which is the signal to upgrade the
 * row on this login.
 */
export async function verifyPassword(password, user, env) {
  const stored = String(user?.pin_hash || "");
  const parsed = parsePasswordHash(stored);

  if (parsed) {
    let key;
    try {
      key = await derivePasswordKey(password, parsed.salt, parsed.iterations);
    } catch {
      // A verifier the platform cannot compute must fail closed, not throw.
      // Otherwise one unsupported row turns every login attempt into a 500.
      return { ok: false, needsRehash: false };
    }
    const ok = equalBytes(key, parsed.hash);
    return { ok, needsRehash: ok && parsed.iterations < resolveIterations(env) };
  }

  const legacySalt = String(user?.salt || "");
  if (!legacySalt || !/^[a-f0-9]{64}$/i.test(stored)) {
    return { ok: false, needsRehash: false };
  }

  const computed = await sha256Hex(`${legacySalt}:${password}`);
  const ok = await constantTimeEqual(computed, stored);
  return { ok, needsRehash: ok };
}

function parsePasswordHash(stored) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== PASSWORD_SCHEME) return null;

  const iterations = Number(parts[1]);
  if (
    !Number.isInteger(iterations) ||
    iterations < MIN_PBKDF2_ITERATIONS ||
    iterations > MAX_PBKDF2_ITERATIONS
  ) {
    return null;
  }

  try {
    const salt = base64ToBytes(parts[2]);
    const hash = base64ToBytes(parts[3]);
    if (!salt.length || !hash.length) return null;
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

async function derivePasswordKey(password, salt, iterations) {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(password ?? "")),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    PASSWORD_KEY_BYTES * 8
  );
  return new Uint8Array(bits);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function sessionCookie(token = "", maxAge = 60 * 60 * 24 * 7) {
  const secure = "Secure; HttpOnly; SameSite=Lax";
  if (!token) return `pf_session=; Path=/; Max-Age=0; ${secure}`;
  return `pf_session=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; ${secure}`;
}

const ITEM_KEY_RE = /^[a-z0-9._-]{1,64}$/i;
const MAX_ITEMS_PER_MONTH = 500;
const MAX_CUSTOM_ITEMS = 200;
const MAX_CATEGORIES = 24;
const MAX_NAME_LENGTH = 80;
const MAX_BUDGET = 1_000_000_000_000;

const BUCKETS = new Set(["needs", "wants", "savings"]);
const CURRENCY_RE = /^[A-Z]{3}$/;
const ICON_RE = /^[a-z0-9:_-]{1,48}$/i;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

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

/** A display label: no control characters, trimmed, bounded. */
function cleanLabel(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

/**
 * Reduce a client-supplied `__meta` block to the shape the app understands.
 *
 * These values are labels and keys, never markup, and the same key rules as
 * the ledger apply. Category names are user-visible text, so they are trimmed
 * and length-capped but otherwise free-form: the seven categories are a client
 * concept, not a server enum.
 */
export function sanitizeSettingsPayload(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(source, key);

  const categories = [];
  if (has("categories") && Array.isArray(source.categories)) {
    const seen = new Set();
    for (const raw of source.categories) {
      if (categories.length >= MAX_CATEGORIES) break;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const name = cleanLabel(raw.name);
      const lowered = name.toLowerCase();
      if (!name || seen.has(lowered)) continue;
      seen.add(lowered);
      categories.push({
        name,
        bucket: BUCKETS.has(raw.bucket) ? raw.bucket : "needs",
        icon: ICON_RE.test(String(raw.icon || "")) ? String(raw.icon) : "ph:tag-bold",
        color: COLOR_RE.test(String(raw.color || "")) ? String(raw.color) : "#0B3D2E",
      });
    }
  }
  const allowedCategories = new Set(categories.map((category) => category.name));

  const items = [];
  if (has("items") && Array.isArray(source.items)) {
    const seen = new Set();
    for (const raw of source.items) {
      if (items.length >= MAX_CUSTOM_ITEMS) break;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const key = String(raw.key ?? "");
      const name = cleanLabel(raw.name);
      const category = cleanLabel(raw.category);
      if (!isSafeItemKey(key) || !name || !category || seen.has(key)) continue;
      // Items are grouped by category name, so an item that points at no
      // declared category would vanish from the screen. Drop it instead of
      // storing a half-visible line.
      if (categories.length && !allowedCategories.has(category)) continue;
      seen.add(key);
      items.push({
        key,
        name,
        category,
        kind: raw.kind === "investment" ? "investment" : "expense",
        fixed: raw.fixed === true,
      });
    }
  }

  const customItems = [];
  if (Array.isArray(source.customItems)) {
    for (const raw of source.customItems) {
      if (customItems.length >= MAX_CUSTOM_ITEMS) break;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const key = String(raw.key ?? "");
      if (!isSafeItemKey(key)) continue;
      const name = cleanLabel(raw.name);
      if (!name) continue;

      const category = cleanLabel(raw.category);
      const amountRaw = raw.defaultAmount;
      const amount = amountRaw == null || amountRaw === "" ? null : Number(amountRaw);
      const item = {
        key,
        name,
        kind: "expense",
        fixed: raw.fixed === true,
        defaultAmount: amountRaw == null || amountRaw === "" || !Number.isFinite(amount) ? null : amount,
      };
      if (category) item.category = category;
      customItems.push(item);
    }
  }

  const hiddenItems = [];
  if (Array.isArray(source.hiddenItems)) {
    for (const raw of source.hiddenItems) {
      if (hiddenItems.length >= MAX_CUSTOM_ITEMS) break;
      const key = String(raw ?? "");
      if (isSafeItemKey(key) && !hiddenItems.includes(key)) hiddenItems.push(key);
    }
  }

  const nameOverrides = {};
  if (source.nameOverrides && typeof source.nameOverrides === "object" && !Array.isArray(source.nameOverrides)) {
    let count = 0;
    for (const [key, raw] of Object.entries(source.nameOverrides)) {
      if (count >= MAX_CUSTOM_ITEMS) break;
      if (!isSafeItemKey(key)) continue;
      const name = cleanLabel(raw);
      if (!name) continue;
      nameOverrides[key] = name;
      count += 1;
    }
  }

  const categoryBudgets = {};
  if (source.categoryBudgets && typeof source.categoryBudgets === "object" && !Array.isArray(source.categoryBudgets)) {
    let count = 0;
    for (const [rawCategory, rawValue] of Object.entries(source.categoryBudgets)) {
      if (count >= MAX_CUSTOM_ITEMS) break;
      const category = cleanLabel(rawCategory);
      const lowered = category.toLowerCase();
      if (!category || lowered === "__proto__" || lowered === "constructor" || lowered === "prototype") continue;
      // When the client sends its category list, a budget for a category that
      // is no longer in it is stale and must not come back.
      if (categories.length && !allowedCategories.has(category)) continue;
      const budget = Number(rawValue);
      if (!Number.isFinite(budget) || budget < 0 || budget > MAX_BUDGET) continue;
      categoryBudgets[category] = Math.round(budget);
      count += 1;
    }
  }

  const clean = { customItems, hiddenItems, nameOverrides, categoryBudgets };

  // Phase 3 fields. They are added only when the request carried them, so an
  // older cached client cannot blank an account's categories by omission; the
  // settings route carries the stored value forward for absent keys.
  if (has("currency")) {
    const currency = String(source.currency || "").trim().toUpperCase();
    clean.currency = CURRENCY_RE.test(currency) ? currency : "";
  }
  if (has("categories")) clean.categories = categories;
  if (has("items")) clean.items = items;
  if (has("onboarded")) clean.onboarded = source.onboarded === true;

  return clean;
}
