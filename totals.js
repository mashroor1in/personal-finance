/**
 * totals.js — every money figure derived from the ledger payload.
 *
 * The module owns *what a stored month means*: how an item resolves to an
 * amount, what the month's outflow/investment/bucket totals are, and how a
 * fixed item inherits last month's amount until the user overrides it.
 *
 * It does not own the ledger or the screen. Callers pass `data` records and
 * the current item definitions in, and the module never touches `document`.
 * That is what lets the totals, category headers, bank figures, insights,
 * trend chart and save all read the same arithmetic from `data` instead of
 * re-reading rendered inputs.
 *
 * `itemValue` is the single rule for what an item is worth this month:
 *   - an explicit `""` means the user cleared it; it does not fall back
 *   - a `fixed` item with no entry inherits the previous month's saved amount
 *   - anything else is blank; the app ships no built-in defaults
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Totals = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function normalizeMonth(month) {
    const record = asRecord(month);
    return {
      salary: record.salary,
      items: asRecord(record.items),
      paid: asRecord(record.paid),
    };
  }

  function numeric(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * The amount shown for one item this month, before any numeric coercion.
   * Preserves `""` so callers can tell a cleared value from a zero.
   */
  function itemValue(item, current, prev) {
    const items = asRecord(current && current.items);
    if (Object.prototype.hasOwnProperty.call(items, item.key)) {
      const raw = items[item.key];
      return raw === "" || raw == null ? "" : raw;
    }
    const prevItems = asRecord(prev && prev.items);
    if (item.fixed && prevItems[item.key] !== undefined && prevItems[item.key] !== "") {
      return prevItems[item.key];
    }
    return "";
  }

  /**
   * Sum one month from the payload.
   *
   * `items` is the list from `getAllItems()` and `categories` is `CATEGORY_MAP`;
   * both are passed in so the module stays independent of app state.
   * `prev` is the previous month's record (or null) and is only consulted for
   * fixed-item inheritance.
   */
  function summarise({ month, current, prev, items, categories } = {}) {
    const record = normalizeMonth(current);
    const previous = prev ? normalizeMonth(prev) : null;
    const list = Array.isArray(items) ? items : [];
    const categoryMap = asRecord(categories);

    let outflow = 0;
    let invest = 0;
    let paidOutflow = 0;
    let paidCount = 0;
    let needsSum = 0;
    let wantsSum = 0;
    let savingsSum = 0;

    const byCategory = {};
    const values = {};

    for (const item of list) {
      const value = numeric(itemValue(item, record, previous));
      values[item.key] = value;

      outflow += value;
      byCategory[item.category] = (byCategory[item.category] || 0) + value;

      if (record.paid[item.key]) {
        paidOutflow += value;
        paidCount += 1;
      }

      if (item.kind === "investment") invest += value;

      const bucket = categoryMap[item.category] && categoryMap[item.category].bucket;
      if (bucket === "needs") needsSum += value;
      else if (bucket === "wants") wantsSum += value;
      else if (bucket === "savings") savingsSum += value;
    }

    const salary = numeric(record.salary);

    return {
      month: month || "",
      salary,
      outflow,
      remaining: salary > 0 ? salary - outflow : 0,
      savingsRate: salary > 0 ? (invest / salary) * 100 : 0,
      invest,
      paidOutflow,
      paidCount,
      needsSum,
      wantsSum,
      savingsSum,
      byCategory,
      values,
    };
  }

  /**
   * Fold the resolved amounts back into a month record before saving, so the
   * payload is exactly what the screen showed — including a fixed item that
   * inherited last month's amount. Existing keys that are not in `items`
   * (a deleted custom item, for example) are kept, matching the old
   * read-the-inputs behaviour.
   */
  function materialise({ current, prev, items } = {}) {
    const record = normalizeMonth(current);
    const previous = prev ? normalizeMonth(prev) : null;
    const list = Array.isArray(items) ? items : [];

    const nextItems = { ...record.items };
    for (const item of list) {
      nextItems[item.key] = itemValue(item, record, previous);
    }

    return {
      salary: record.salary,
      items: nextItems,
      paid: { ...record.paid },
    };
  }

  return { itemValue, summarise, materialise };
});
