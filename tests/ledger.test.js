import test from "node:test";
import assert from "node:assert/strict";

import Ledger from "../ledger.js";

test("a new account starts with defaults and an empty ledger", () => {
  const meta = Ledger.migrateMeta({}, { hasMonths: false, defaultCurrency: "GBP" });

  assert.equal(meta.onboarded, false);
  assert.equal(meta.currency, "GBP");
  assert.equal(meta.items.length, 0);
  assert.equal(meta.categories.length, Ledger.DEFAULT_CATEGORIES.length);
});

test("an account with months keeps its compiled line items", () => {
  const meta = Ledger.migrateMeta({}, { hasMonths: true });

  assert.equal(meta.onboarded, true);
  assert.equal(meta.currency, "INR");
  assert.equal(meta.items.length, Ledger.LEGACY_ITEMS.length);
  assert.equal(meta.items.find((item) => item.key === "rent").name, "Rent");
});

test("hidden items, renames and custom items survive the conversion", () => {
  const meta = Ledger.migrateMeta(
    {
      customItems: [{ key: "gym", name: "Gym", category: "Family / Personal", kind: "expense", fixed: false }],
      hiddenItems: ["maid"],
      nameOverrides: { rent: "House rent", gym: "Gym membership" },
      categoryBudgets: { "Home / Living": 20000 },
    },
    { hasMonths: true }
  );

  assert.equal(meta.items.some((item) => item.key === "maid"), false);
  assert.equal(meta.items.find((item) => item.key === "rent").name, "House rent");
  assert.equal(meta.items.find((item) => item.key === "gym").name, "Gym membership");
  assert.equal(meta.onboarded, true);
});

test("an account that already defines its ledger is left alone", () => {
  const meta = Ledger.migrateMeta(
    {
      currency: "USD",
      onboarded: true,
      categories: [{ name: "Bills", bucket: "needs", icon: "ph:tag-bold", color: "#18815A" }],
      items: [{ key: "rent", name: "Rent", category: "Bills", kind: "expense", fixed: true }],
    },
    { hasMonths: true }
  );

  assert.equal(meta.currency, "USD");
  assert.deepEqual(meta.items, [
    { key: "rent", name: "Rent", category: "Bills", kind: "expense", fixed: true },
  ]);
  assert.equal(meta.categories.length, 1);
});

test("an empty item list is a decision, not a missing value", () => {
  const meta = Ledger.migrateMeta(
    { currency: "USD", onboarded: true, categories: [], items: [] },
    { hasMonths: false }
  );

  assert.deepEqual(meta.items, []);
  assert.equal(meta.categories.length, Ledger.DEFAULT_CATEGORIES.length);
});

test("junk categories and items are dropped instead of rendered", () => {
  const meta = Ledger.normalizeMeta({
    categories: [
      { name: "  Bills  ", bucket: "nonsense", icon: "<script>", color: "red" },
      { name: "" },
      null,
    ],
    items: [
      { key: "rent", name: "Rent", category: "Bills" },
      { key: "<script>", name: "Bad", category: "Bills" },
      { key: "nameless", name: " ", category: "Bills" },
    ],
  });

  assert.deepEqual(meta.categories, [
    { name: "Bills", bucket: "needs", icon: "ph:tag-bold", color: Ledger.CATEGORY_COLORS[0] },
  ]);
  assert.deepEqual(meta.items, [
    { key: "rent", name: "Rent", category: "Bills", kind: "expense", fixed: false },
  ]);
});

test("item keys are slugged and never collide", () => {
  assert.equal(Ledger.itemKey("Gym membership", []), "gym_membership");
  assert.equal(Ledger.itemKey("Gym membership", ["gym_membership"]), "gym_membership_2");
  assert.equal(Ledger.itemKey("   ", []), "item");
});

test("money follows the account currency", () => {
  assert.equal(Ledger.formatCurrency(1234567, "INR"), "₹12,34,567");
  assert.equal(Ledger.formatCurrency(1234567, "USD"), "$1,234,567");
  assert.equal(Ledger.currencySymbol("INR"), "₹");
  assert.equal(Ledger.currencySymbol("AED"), "AED");
  assert.match(Ledger.formatCompact(150000, "INR"), /L/);
});

test("an unknown currency falls back to US dollars", () => {
  assert.equal(Ledger.currencyFor("ZZZ").code, "USD");
  assert.equal(Ledger.formatCurrency(10, "ZZZ"), "$10");
});

test("the picker preselects a currency from the browser region", () => {
  assert.equal(Ledger.detectCurrency("en-IN"), "INR");
  assert.equal(Ledger.detectCurrency("en-GB"), "GBP");
  assert.equal(Ledger.detectCurrency("de-DE"), "EUR");
  assert.equal(Ledger.detectCurrency("pt-BR"), "BRL");
  assert.equal(Ledger.detectCurrency("not a locale"), "USD");
});

test("the category map exposes only what the renderer needs", () => {
  const map = Ledger.categoryMap([
    { name: "Bills", bucket: "needs", icon: "ph:tag-bold", color: "#123456" },
    null,
  ]);

  assert.deepEqual(map, { Bills: { bucket: "needs", icon: "ph:tag-bold", color: "#123456" } });
});

test("a new category gets a colour the ledger is not already using", () => {
  const used = [{ color: Ledger.CATEGORY_COLORS[0] }, { color: Ledger.CATEGORY_COLORS[1] }];
  assert.equal(Ledger.nextCategoryColor(used), Ledger.CATEGORY_COLORS[2]);
});

test("when every colour is taken a new category still gets one", () => {
  const used = Ledger.CATEGORY_COLORS.map((color) => ({ color }));
  assert.ok(Ledger.CATEGORY_COLORS.includes(Ledger.nextCategoryColor(used)));
});

