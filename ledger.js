/**
 * ledger.js — what a ledger is made of, and how an old one becomes an account.
 *
 * The planner used to ship one person's life in `app.html`: seven fixed
 * categories, twenty-two named expenses, Indian rupees and a list of specific
 * bank accounts. That is fine for one user and wrong for a product, so the
 * definitions now live in account settings (`__meta`) and this module owns the
 * pure parts:
 *
 *   - the starter categories and the currencies the picker offers
 *   - the one-time conversion of the old hardcoded ledger into account state
 *   - formatting money for the currency the account chose
 *
 * No DOM, no storage, no requests. Everything here is testable and the page
 * only renders what these functions return.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Ledger = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CURRENCIES = [
    { code: "INR", locale: "en-IN", label: "Indian rupee" },
    { code: "USD", locale: "en-US", label: "US dollar" },
    { code: "EUR", locale: "de-DE", label: "Euro" },
    { code: "GBP", locale: "en-GB", label: "British pound" },
    { code: "AED", locale: "en-AE", label: "UAE dirham" },
    { code: "CAD", locale: "en-CA", label: "Canadian dollar" },
    { code: "AUD", locale: "en-AU", label: "Australian dollar" },
    { code: "SGD", locale: "en-SG", label: "Singapore dollar" },
    { code: "JPY", locale: "ja-JP", label: "Japanese yen" },
    { code: "ZAR", locale: "en-ZA", label: "South African rand" },
    { code: "NGN", locale: "en-NG", label: "Nigerian naira" },
    { code: "BRL", locale: "pt-BR", label: "Brazilian real" },
  ];

  const CURRENCY_CODES = new Set(CURRENCIES.map((entry) => entry.code));
  const REGION_CURRENCY = {
    IN: "INR",
    US: "USD",
    GB: "GBP",
    AE: "AED",
    CA: "CAD",
    AU: "AUD",
    SG: "SGD",
    JP: "JPY",
    ZA: "ZAR",
    NG: "NGN",
    BR: "BRL",
    DE: "EUR",
    FR: "EUR",
    ES: "EUR",
    IT: "EUR",
    NL: "EUR",
    IE: "EUR",
    PT: "EUR",
    AT: "EUR",
    BE: "EUR",
    FI: "EUR",
    GR: "EUR",
  };

  const BUCKETS = new Set(["needs", "wants", "savings"]);

  /**
   * The seven categories the product launches with. They are only defaults:
   * every account can rename, delete or add to this list.
   */
  const DEFAULT_CATEGORIES = [
    { name: "Home / Living", bucket: "needs", icon: "ph:house-line-bold", color: "#0B3D2E" },
    { name: "Food / Household", bucket: "needs", icon: "ph:shopping-cart-bold", color: "#18815A" },
    { name: "Utilities / Communication", bucket: "needs", icon: "ph:lightning-bold", color: "#5E7F72" },
    { name: "Education", bucket: "needs", icon: "ph:graduation-cap-bold", color: "#C97A0C" },
    { name: "Family / Personal", bucket: "wants", icon: "ph:user-bold", color: "#C9A227" },
    { name: "Repayments", bucket: "needs", icon: "ph:credit-card-bold", color: "#B5453C" },
    { name: "Investment / Savings", bucket: "savings", icon: "ph:chart-line-up-bold", color: "#8CBF9B" },
  ];

  /**
   * The ledger that used to be compiled into the page. It is kept only so an
   * account created before Phase 3 can be converted without losing a row.
   * Nothing renders from this list any more.
   */
  const LEGACY_ITEMS = [
    { category: "Home / Living", name: "Rent", key: "rent", kind: "expense", fixed: true },
    { category: "Home / Living", name: "Flat maintenance", key: "flat_maintenance", kind: "expense", fixed: true },
    { category: "Food / Household", name: "Groceries", key: "groceries", kind: "expense", fixed: true },
    { category: "Food / Household", name: "Maid", key: "maid", kind: "expense", fixed: true },
    { category: "Food / Household", name: "Cash expenses", key: "cash_expenses", kind: "expense", fixed: true },
    { category: "Food / Household", name: "LPG gas", key: "lpg_gas", kind: "expense", fixed: true },
    { category: "Utilities / Communication", name: "Electricity bill", key: "electricity_bill", kind: "expense", fixed: false },
    { category: "Utilities / Communication", name: "WiFi", key: "wifi", kind: "expense", fixed: true },
    { category: "Utilities / Communication", name: "Phone recharge", key: "phone_recharge", kind: "expense", fixed: false },
    { category: "Education", name: "School fee", key: "school_fee", kind: "expense", fixed: true },
    { category: "Education", name: "Tuition fee", key: "tuition_fee", kind: "expense", fixed: true },
    { category: "Education", name: "College fee", key: "college_fee", kind: "expense", fixed: true },
    { category: "Family / Personal", name: "Ayesha pocket money", key: "ayesha_pocket", kind: "expense", fixed: true },
    { category: "Family / Personal", name: "Mash", key: "mash", kind: "expense", fixed: true },
    { category: "Repayments", name: "Credit card (Axis)", key: "cc_axis", kind: "expense", fixed: true },
    { category: "Repayments", name: "Credit card (ICICI)", key: "cc_icici", kind: "expense", fixed: true },
    { category: "Repayments", name: "Credit card (Amazon)", key: "cc_amazon", kind: "expense", fixed: true },
    { category: "Investment / Savings", name: "Personal SIP", key: "personal_sip", kind: "investment", fixed: true },
    { category: "Investment / Savings", name: "Baby SIP", key: "baby_sip", kind: "investment", fixed: true },
    { category: "Investment / Savings", name: "LIC", key: "lic", kind: "investment", fixed: true },
    { category: "Investment / Savings", name: "RD", key: "rd", kind: "investment", fixed: true },
    { category: "Investment / Savings", name: "RD (college)", key: "rd_college", kind: "investment", fixed: true },
  ];

  const CATEGORY_COLORS = [
    "#0B3D2E", "#18815A", "#C97A0C", "#8CBF9B", "#C9A227", "#5E7F72", "#566F62", "#B5453C",
  ];

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function cleanLabel(value, max = 80) {
    return String(value ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, max);
  }

  function isSafeKey(key) {
    const value = String(key || "");
    if (!/^[a-z0-9._-]{1,64}$/i.test(value)) return false;
    const lowered = value.toLowerCase();
    return lowered !== "__proto__" && lowered !== "prototype" && lowered !== "constructor";
  }

  function slugify(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  /** A stable key for a new item, never colliding with one that exists. */
  function itemKey(name, existingKeys = []) {
    const taken = new Set((existingKeys || []).map((key) => String(key).toLowerCase()));
    const base = slugify(name).slice(0, 50) || "item";
    let key = base;
    let index = 2;
    while (taken.has(key)) {
      key = `${base}_${index}`;
      index += 1;
    }
    return key;
  }

  function cleanCategory(raw) {
    if (!isRecord(raw)) return null;
    const name = cleanLabel(raw.name);
    if (!name) return null;
    return {
      name,
      bucket: BUCKETS.has(raw.bucket) ? raw.bucket : "needs",
      icon: /^[a-z0-9:-]{1,48}$/i.test(String(raw.icon || "")) ? String(raw.icon) : "ph:tag-bold",
      color: /^#[0-9a-f]{6}$/i.test(String(raw.color || "")) ? String(raw.color) : CATEGORY_COLORS[0],
    };
  }

  function cleanItem(raw) {
    if (!isRecord(raw)) return null;
    const key = String(raw.key ?? "");
    const name = cleanLabel(raw.name);
    const category = cleanLabel(raw.category);
    if (!isSafeKey(key) || !name || !category) return null;
    return {
      key,
      name,
      category,
      kind: raw.kind === "investment" ? "investment" : "expense",
      fixed: raw.fixed === true,
    };
  }

  function dedupeCategories(list) {
    const seen = new Set();
    const out = [];
    for (const category of list) {
      const lowered = category.name.toLowerCase();
      if (seen.has(lowered)) continue;
      seen.add(lowered);
      out.push(category);
    }
    return out;
  }

  function dedupeItems(list) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      out.push(item);
    }
    return out;
  }

  /**
   * The stored shape, without inventing anything.
   *
   * `categories` and `items` are `null` when the account has never defined
   * them. That difference matters: `null` means "convert me", `[]` means "this
   * account really has none".
   */
  function normalizeMeta(meta) {
    const source = isRecord(meta) ? meta : {};
    const categories = Array.isArray(source.categories)
      ? dedupeCategories(source.categories.map(cleanCategory).filter(Boolean))
      : null;
    const items = Array.isArray(source.items)
      ? dedupeItems(source.items.map(cleanItem).filter(Boolean))
      : null;

    const budgets = {};
    if (isRecord(source.categoryBudgets)) {
      for (const [name, value] of Object.entries(source.categoryBudgets)) {
        const category = cleanLabel(name);
        const amount = Number(value);
        if (!category || !Number.isFinite(amount) || amount < 0) continue;
        budgets[category] = Math.round(amount);
      }
    }

    return {
      currency: CURRENCY_CODES.has(String(source.currency || "")) ? String(source.currency) : "",
      categories,
      items,
      onboarded: source.onboarded === true,
      categoryBudgets: budgets,
      // Retained so an account coming from the old shape can be converted.
      customItems: Array.isArray(source.customItems)
        ? source.customItems.map(cleanItem).filter(Boolean)
        : [],
      hiddenItems: Array.isArray(source.hiddenItems)
        ? source.hiddenItems.map(String).filter(isSafeKey)
        : [],
      nameOverrides: isRecord(source.nameOverrides) ? { ...source.nameOverrides } : {},
    };
  }

  /**
   * Expand the old compiled ledger into a user-owned list.
   *
   * Hidden items stay out, renames win, and custom items are appended in the
   * order they were created. Keys are preserved, so every amount already
   * stored under a month keeps pointing at the same line.
   */
  function legacyItems(meta) {
    const source = normalizeMeta(meta);
    const hidden = new Set(source.hiddenItems);
    const overrides = source.nameOverrides || {};
    const base = LEGACY_ITEMS.filter((item) => !hidden.has(item.key)).map((item) => ({
      ...item,
      name: cleanLabel(overrides[item.key]) || item.name,
    }));
    const custom = source.customItems.map((item) => ({
      ...item,
      name: cleanLabel(overrides[item.key]) || item.name,
    }));
    return dedupeItems([...base, ...custom]);
  }

  /**
   * Convert an account's stored meta into the current shape.
   *
   * `hasMonths` is the signal that this is an existing ledger rather than a
   * brand-new account: an account with months must never lose its line items
   * or be walked through onboarding again.
   */
  function migrateMeta(meta, { hasMonths = false, defaultCurrency = "USD" } = {}) {
    const next = normalizeMeta(meta);
    const legacyHasContent =
      next.customItems.length > 0 ||
      next.hiddenItems.length > 0 ||
      Object.keys(next.nameOverrides).length > 0 ||
      Object.keys(next.categoryBudgets).length > 0;
    const existing = hasMonths || legacyHasContent;

    if (!next.categories || next.categories.length === 0) {
      next.categories = DEFAULT_CATEGORIES.map((category) => ({ ...category }));
    }

    if (!next.items) {
      next.items = existing ? legacyItems(next) : [];
      if (existing) next.onboarded = true;
    }

    if (!next.currency) {
      next.currency = existing ? "INR" : (CURRENCY_CODES.has(defaultCurrency) ? defaultCurrency : "USD");
    }

    return next;
  }

  function currencyFor(code) {
    const match = CURRENCIES.find((entry) => entry.code === code);
    return match || CURRENCIES[1];
  }

  function currencySymbol(code) {
    const { locale, code: currency } = currencyFor(code);
    try {
      const parts = new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).formatToParts(0);
      const symbol = parts.find((part) => part.type === "currency");
      return symbol ? symbol.value : currency;
    } catch {
      return currency;
    }
  }

  function formatCurrency(amount, code) {
    const { locale, code: currency } = currencyFor(code);
    const value = Number(amount);
    const safe = Number.isFinite(value) ? value : 0;
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(safe);
    } catch {
      return `${currencySymbol(code)}${safe}`;
    }
  }

  function formatCompact(amount, code) {
    const { locale, code: currency } = currencyFor(code);
    const value = Number(amount);
    const safe = Number.isFinite(value) ? value : 0;
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(safe);
    } catch {
      return formatCurrency(safe, code);
    }
  }

  /** Best guess for the picker's initial value, from the browser locale. */
  function detectCurrency(locale) {
    try {
      const parsed = new Intl.Locale(String(locale || ""));
      const region = parsed.region || parsed.maximize().region;
      if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region];
    } catch {
      // An unparseable locale is not an error; USD is a fine default.
    }
    return "USD";
  }

  /** `{ name: { bucket, icon, color } }`, the shape the renderer wants. */
  function categoryMap(categories) {
    const map = {};
    for (const category of categories || []) {
      if (!category || !category.name) continue;
      map[category.name] = {
        bucket: category.bucket,
        icon: category.icon,
        color: category.color,
      };
    }
    return map;
  }

  function nextCategoryColor(categories) {
    const used = new Set((categories || []).map((category) => category.color));
    return CATEGORY_COLORS.find((color) => !used.has(color)) || CATEGORY_COLORS[0];
  }

  return {
    CURRENCIES,
    CATEGORY_COLORS,
    DEFAULT_CATEGORIES,
    LEGACY_ITEMS,
    BUCKETS,
    categoryMap,
    currencyFor,
    currencySymbol,
    detectCurrency,
    formatCompact,
    formatCurrency,
    itemKey,
    legacyItems,
    migrateMeta,
    nextCategoryColor,
    normalizeMeta,
    slugify,
  };
});
