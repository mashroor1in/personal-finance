const test = require("node:test");
const assert = require("node:assert/strict");

const Totals = require("../totals.js");

const CATEGORIES = {
  Housing: { bucket: "needs" },
  Food: { bucket: "needs" },
  Leisure: { bucket: "wants" },
  Investing: { bucket: "savings" },
};

const ITEMS = [
  { key: "rent", category: "Housing", kind: "expense", fixed: true },
  { key: "groceries", category: "Food", kind: "expense" },
  { key: "streaming", category: "Leisure", kind: "expense" },
  { key: "sip", category: "Investing", kind: "investment", fixed: true },
];

function month(partial = {}) {
  return {
    salary: "",
    items: {},
    paid: {},
    ...partial,
  };
}

function summarise(current, prev = null) {
  return Totals.summarise({
    month: "2026-11",
    current,
    prev,
    items: ITEMS,
    categories: CATEGORIES,
  });
}

test("itemValue returns the stored value", () => {
  const current = month({ items: { groceries: 4200 } });
  assert.equal(Totals.itemValue(ITEMS[1], current, null), 4200);
});

test("itemValue keeps an explicit zero instead of inheriting", () => {
  const current = month({ items: { rent: 0 } });
  const prev = month({ items: { rent: 20000 } });
  assert.equal(Totals.itemValue(ITEMS[0], current, prev), 0);
});

test("itemValue treats an explicit empty string as cleared, never a fallback", () => {
  const current = month({ items: { rent: "" } });
  const prev = month({ items: { rent: 20000 } });
  assert.equal(Totals.itemValue(ITEMS[0], current, prev), "");
});

test("itemValue lets a fixed item inherit the previous month's amount", () => {
  const current = month({ items: {} });
  const prev = month({ items: { rent: 20000 } });
  assert.equal(Totals.itemValue(ITEMS[0], current, prev), 20000);
});

test("itemValue does not inherit for a non-fixed item", () => {
  const current = month({ items: {} });
  const prev = month({ items: { groceries: 4200 } });
  assert.equal(Totals.itemValue(ITEMS[1], current, prev), "");
});

test("itemValue is blank when neither month has a value", () => {
  assert.equal(Totals.itemValue(ITEMS[1], month(), month()), "");
  assert.equal(Totals.itemValue(ITEMS[1], month(), null), "");
});

test("summarise totals outflow, investment, remaining and savings rate", () => {
  const current = month({
    salary: 100000,
    items: { rent: 30000, groceries: 12000, streaming: 8000, sip: 15000 },
  });

  const totals = summarise(current);

  assert.equal(totals.salary, 100000);
  assert.equal(totals.outflow, 65000);
  assert.equal(totals.invest, 15000);
  assert.equal(totals.remaining, 35000);
  assert.equal(totals.savingsRate, 15);
});

test("summarise reports zero percentages when income is unset", () => {
  const totals = summarise(month({ salary: "", items: { rent: 30000 } }));
  assert.equal(totals.salary, 0);
  assert.equal(totals.remaining, 0);
  assert.equal(totals.savingsRate, 0);
});

test("summarise includes a fixed item's inherited amount", () => {
  const prev = month({ items: { rent: 20000, sip: 5000 } });
  const totals = summarise(month({ items: {} }), prev);

  assert.equal(totals.outflow, 25000);
  assert.equal(totals.invest, 5000);
  assert.equal(totals.values.rent, 20000);
  assert.equal(totals.values.sip, 5000);
});

test("summarise groups amounts by category and bucket", () => {
  const totals = summarise(month({
    items: { rent: 30000, groceries: 12000, streaming: 8000, sip: 5000 },
  }));

  assert.deepEqual(totals.byCategory, {
    Housing: 30000,
    Food: 12000,
    Leisure: 8000,
    Investing: 5000,
  });
  assert.equal(totals.needsSum, 42000);
  assert.equal(totals.wantsSum, 8000);
  assert.equal(totals.savingsSum, 5000);
});

test("summarise counts paid items and sums their amounts", () => {
  const totals = summarise(month({
    items: { rent: 30000, groceries: 12000, streaming: 8000 },
    paid: { rent: true, groceries: true, streaming: false },
  }));

  assert.equal(totals.paidOutflow, 42000);
  assert.equal(totals.paidCount, 2);
});

test("summarise counts a paid item even when its amount is zero", () => {
  const totals = summarise(month({ items: { rent: 0 }, paid: { rent: true } }));
  assert.equal(totals.paidCount, 1);
  assert.equal(totals.paidOutflow, 0);
});

test("summarise coerces non-numeric stored values to zero", () => {
  const totals = summarise(month({ items: { groceries: "not a number" } }));
  assert.equal(totals.values.groceries, 0);
  assert.equal(totals.outflow, 0);
});

test("summarise tolerates a missing or malformed month record", () => {
  const empty = Totals.summarise({
    month: "2026-11",
    current: null,
    prev: null,
    items: ITEMS,
    categories: CATEGORIES,
  });
  assert.equal(empty.outflow, 0);
  assert.equal(empty.salary, 0);

  const malformed = Totals.summarise({
    month: "2026-11",
    current: { salary: 1000, items: [], paid: "nope" },
    items: ITEMS,
    categories: CATEGORIES,
  });
  assert.equal(malformed.salary, 1000);
  assert.equal(malformed.outflow, 0);
  assert.equal(malformed.paidCount, 0);
});

test("summarise does not mutate the record it reads", () => {
  const current = month({ items: { rent: 30000 } });
  const before = JSON.stringify(current);
  summarise(current);
  assert.equal(JSON.stringify(current), before);
});

test("materialise writes resolved amounts, including inherited fixed items", () => {
  const prev = month({ items: { rent: 20000, sip: 5000 } });
  const current = month({ items: { groceries: 4200 } });

  const saved = Totals.materialise({ current, prev, items: ITEMS });

  assert.deepEqual(saved.items, {
    groceries: 4200,
    rent: 20000,
    streaming: "",
    sip: 5000,
  });
});

test("materialise keeps stored keys that are no longer in the item list", () => {
  const current = month({ items: { rent: 30000, retired_item: 900 } });
  const saved = Totals.materialise({ current, prev: null, items: [ITEMS[0]] });
  assert.equal(saved.items.retired_item, 900);
});

test("materialise preserves salary and paid and leaves the input untouched", () => {
  const current = month({
    salary: 90000,
    items: { rent: 30000 },
    paid: { rent: true },
  });
  const before = JSON.stringify(current);

  const saved = Totals.materialise({ current, prev: null, items: ITEMS });

  assert.equal(saved.salary, 90000);
  assert.deepEqual(saved.paid, { rent: true });
  assert.notEqual(saved.items, current.items);
  assert.notEqual(saved.paid, current.paid);
  assert.equal(JSON.stringify(current), before);
});

test("materialise keeps a cleared item blank instead of inheriting", () => {
  const prev = month({ items: { rent: 20000 } });
  const current = month({ items: { rent: "" } });
  const saved = Totals.materialise({ current, prev, items: ITEMS });
  assert.equal(saved.items.rent, "");
});
