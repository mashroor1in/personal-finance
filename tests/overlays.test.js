const test = require("node:test");
const assert = require("node:assert/strict");

const Overlays = require("../overlays.js");

/** A stand-in for a DOM element that records focus() calls. */
function element(label) {
  return {
    label,
    focusCalls: [],
    focus(options) {
      this.focusCalls.push(options === undefined ? "no-options" : options);
    },
  };
}

/**
 * A surface adapter that records what the controller asked it to do.
 * `inside` lists the targets that count as clicks inside this surface.
 */
function surface(options = {}) {
  return {
    shown: 0,
    hidden: 0,
    outside: [],
    show() {
      this.shown += 1;
    },
    hide() {
      this.hidden += 1;
    },
    ...options,
  };
}

function setup(options) {
  let current = null;
  const overlays = Overlays.create({
    activeElement: () => current,
  });
  return {
    overlays,
    focus(target) {
      current = target;
    },
    surface(name, adapter) {
      overlays.register(name, adapter);
      return adapter;
    },
  };
}

/* Registration ----------------------------------------------------------- */

test("register rejects a missing name", () => {
  const { overlays } = setup();
  assert.throws(() => overlays.register("", surface()), TypeError);
  assert.throws(() => overlays.register(null, surface()), TypeError);
});

test("register rejects an adapter without show and hide", () => {
  const { overlays } = setup();
  assert.throws(() => overlays.register("menu", null), TypeError);
  assert.throws(() => overlays.register("menu", {}), TypeError);
  assert.throws(() => overlays.register("menu", { show() {} }), TypeError);
  assert.throws(() => overlays.register("menu", { hide() {} }), TypeError);
});

test("register accepts an adapter with only show and hide", () => {
  const { overlays } = setup();
  overlays.register("menu", surface());
  assert.equal(overlays.open("menu"), true);
});

/* Open, close, toggle ---------------------------------------------------- */

test("open shows the surface and reports it as open", () => {
  const { overlays, surface: register } = setup();
  const menu = register("menu", surface());
  assert.equal(overlays.isOpen("menu"), false);
  assert.equal(overlays.open("menu"), true);
  assert.equal(overlays.isOpen("menu"), true);
  assert.equal(menu.shown, 1);
});

test("open is a no-op for an unknown surface", () => {
  const { overlays } = setup();
  assert.equal(overlays.open("ghost"), false);
  assert.deepEqual(overlays.openOverlays(), []);
});

test("re-opening an open surface does nothing", () => {
  const { overlays, surface: register } = setup();
  const menu = register("menu", surface());
  overlays.open("menu");
  assert.equal(overlays.open("menu"), false);
  assert.equal(menu.shown, 1);
});

test("close hides the surface and reports it as closed", () => {
  const { overlays, surface: register } = setup();
  const menu = register("menu", surface());
  overlays.open("menu");
  assert.equal(overlays.close("menu"), true);
  assert.equal(overlays.isOpen("menu"), false);
  assert.equal(menu.hidden, 1);
});

test("closing a surface that is not open is a no-op", () => {
  const { overlays, surface: register } = setup();
  const menu = register("menu", surface());
  assert.equal(overlays.close("menu"), false);
  assert.equal(menu.hidden, 0);
});

test("close is a no-op for an unknown surface", () => {
  const { overlays } = setup();
  assert.equal(overlays.close("ghost"), false);
});

test("toggle opens a closed surface and closes an open one", () => {
  const { overlays, surface: register } = setup();
  const menu = register("menu", surface());
  assert.equal(overlays.toggle("menu"), true);
  assert.equal(overlays.isOpen("menu"), true);
  assert.equal(overlays.toggle("menu"), false);
  assert.equal(overlays.isOpen("menu"), false);
  assert.equal(menu.shown, 1);
  assert.equal(menu.hidden, 1);
});

test("a surface whose show throws is left closed", () => {
  const { overlays, surface: register } = setup();
  const failing = register("bad", surface({
    show() {
      throw new Error("boom");
    },
  }));
  assert.throws(() => overlays.open("bad"), /boom/);
  assert.equal(overlays.isOpen("bad"), false);
  assert.equal(failing.hidden, 0);
});

/* Escape ---------------------------------------------------------------- */

test("dismissTop closes the most recently opened surface", () => {
  const { overlays, surface: register } = setup();
  const first = register("first", surface());
  const second = register("second", surface());
  overlays.open("first");
  overlays.open("second");

  assert.equal(overlays.dismissTop(), "second");
  assert.equal(first.hidden, 0);
  assert.equal(second.hidden, 1);

  assert.equal(overlays.dismissTop(), "first");
  assert.equal(first.hidden, 1);
  assert.equal(overlays.dismissTop(), null);
});

test("re-opening a surface moves it back to the top of the stack", () => {
  const { overlays, surface: register } = setup();
  register("a", surface());
  register("b", surface());
  overlays.open("a");
  overlays.open("b");
  overlays.close("a");
  overlays.open("a");
  assert.deepEqual(overlays.openOverlays(), ["b", "a"]);
  assert.equal(overlays.dismissTop(), "a");
  assert.equal(overlays.dismissTop(), "b");
});

test("dismissTop skips non-dismissible surfaces", () => {
  const { overlays, surface: register } = setup();
  register("menu", surface());
  register("lock", surface({ dismissible: false }));
  overlays.open("menu");
  overlays.open("lock");

  assert.equal(overlays.dismissTop(), "menu");
  assert.equal(overlays.isOpen("lock"), true);
  assert.equal(overlays.dismissTop(), null);
});

test("onDismiss can consume the press without closing", () => {
  const { overlays, surface: register } = setup();
  const confirm = surface({
    onDismiss() {
      return false;
    },
  });
  register("menu", surface());
  register("confirm", confirm);
  overlays.open("menu");
  overlays.open("confirm");

  assert.equal(overlays.dismissTop(), null);
  assert.equal(overlays.isOpen("confirm"), true);
  assert.equal(confirm.hidden, 0);

  confirm.onDismiss = () => true;
  assert.equal(overlays.dismissTop(), "confirm");
  assert.equal(confirm.hidden, 1);
});

test("onDismiss receives the event", () => {
  const { overlays, surface: register } = setup();
  const event = { key: "Escape" };
  let seen = null;
  register("menu", surface({
    onDismiss(e) {
      seen = e;
    },
  }));
  overlays.open("menu");
  overlays.dismissTop(event);
  assert.equal(seen, event);
});

/* Outside clicks --------------------------------------------------------- */

test("dismissOutside closes only the surfaces the target is outside of", () => {
  const { overlays, surface: register } = setup();
  const inside = element("inside");
  const outside = element("outside");
  const menu = surface({
    isOutsideClick: (target) => target !== inside,
  });
  register("menu", menu);
  overlays.open("menu");

  assert.deepEqual(overlays.dismissOutside(inside), []);
  assert.equal(overlays.isOpen("menu"), true);

  assert.deepEqual(overlays.dismissOutside(outside), ["menu"]);
  assert.equal(overlays.isOpen("menu"), false);
  assert.equal(menu.hidden, 1);
});

test("an adapter without isOutsideClick closes on any outside click", () => {
  const { overlays, surface: register } = setup();
  register("menu", surface());
  overlays.open("menu");
  assert.deepEqual(overlays.dismissOutside(element("somewhere")), ["menu"]);
});

test("dismissOutside closes nested surfaces from the top down", () => {
  const { overlays, surface: register } = setup();
  const order = [];
  const insideTarget = element("inside");
  register("outer", surface({
    isOutsideClick: () => true,
    hide() {
      order.push("outer");
    },
  }));
  register("inner", surface({
    isOutsideClick: () => true,
    hide() {
      order.push("inner");
    },
  }));
  overlays.open("outer");
  overlays.open("inner");
  assert.deepEqual(overlays.dismissOutside(insideTarget), ["inner", "outer"]);
  assert.deepEqual(order, ["inner", "outer"]);
});

test("dismissOutside leaves non-dismissible surfaces open", () => {
  const { overlays, surface: register } = setup();
  register("lock", surface({ dismissible: false, isOutsideClick: () => true }));
  overlays.open("lock");
  assert.deepEqual(overlays.dismissOutside(element("outside")), []);
  assert.equal(overlays.isOpen("lock"), true);
});

/* Focus ----------------------------------------------------------------- */

test("a deliberate close restores focus to the element that opened it", () => {
  const { overlays, focus, surface: register } = setup();
  const trigger = element("trigger");
  register("menu", surface());
  focus(trigger);
  overlays.open("menu");
  overlays.close("menu");
  assert.deepEqual(trigger.focusCalls, [{ preventScroll: true }]);
});

test("an explicit trigger wins over the focused element", () => {
  const { overlays, focus, surface: register } = setup();
  const focused = element("focused");
  const explicit = element("explicit");
  register("menu", surface());
  focus(focused);
  overlays.open("menu", { trigger: explicit });
  overlays.close("menu");
  assert.deepEqual(focused.focusCalls, []);
  assert.deepEqual(explicit.focusCalls, [{ preventScroll: true }]);
});

test("an outside-click close does not restore focus", () => {
  const { overlays, focus, surface: register } = setup();
  const trigger = element("trigger");
  register("menu", surface({ isOutsideClick: () => true }));
  focus(trigger);
  overlays.open("menu");
  overlays.dismissOutside(element("outside"));
  assert.deepEqual(trigger.focusCalls, []);
});

test("restoreFocus: false on close leaves focus alone", () => {
  const { overlays, focus, surface: register } = setup();
  const trigger = element("trigger");
  register("menu", surface());
  focus(trigger);
  overlays.open("menu");
  overlays.close("menu", { restoreFocus: false });
  assert.deepEqual(trigger.focusCalls, []);
});

test("an adapter can opt out of focus restore", () => {
  const { overlays, focus, surface: register } = setup();
  const trigger = element("trigger");
  register("modal", surface({ restoreFocus: false }));
  focus(trigger);
  overlays.open("modal");
  overlays.close("modal");
  assert.deepEqual(trigger.focusCalls, []);
});

test("an adapter opt-out is overridden by an explicit restoreFocus", () => {
  const { overlays, focus, surface: register } = setup();
  const trigger = element("trigger");
  register("modal", surface({ restoreFocus: false }));
  focus(trigger);
  overlays.open("modal");
  overlays.close("modal", { restoreFocus: true });
  assert.deepEqual(trigger.focusCalls, [{ preventScroll: true }]);
});

test("a missing trigger does not throw", () => {
  const { overlays, surface: register } = setup();
  register("menu", surface());
  overlays.open("menu");
  assert.equal(overlays.close("menu"), true);
});

test("a trigger without focus() is ignored", () => {
  const { overlays, surface: register } = setup();
  register("menu", surface());
  overlays.open("menu", { trigger: {} });
  assert.equal(overlays.close("menu"), true);
});

test("closing and reopening captures the trigger each time", () => {
  const { overlays, focus, surface: register } = setup();
  const first = element("first");
  const second = element("second");
  register("menu", surface());
  focus(first);
  overlays.open("menu");
  overlays.close("menu");
  focus(second);
  overlays.open("menu");
  overlays.close("menu");
  assert.equal(first.focusCalls.length, 1);
  assert.equal(second.focusCalls.length, 1);
});

/* Bulk operations ------------------------------------------------------- */

test("closeAll closes every open surface", () => {
  const { overlays, surface: register } = setup();
  const a = register("a", surface());
  const b = register("b", surface());
  overlays.open("a");
  overlays.open("b");
  overlays.closeAll();
  assert.deepEqual(overlays.openOverlays(), []);
  assert.equal(a.hidden, 1);
  assert.equal(b.hidden, 1);
});

test("closeAll can skip focus restore", () => {
  const { overlays, focus, surface: register } = setup();
  const trigger = element("trigger");
  register("a", surface());
  focus(trigger);
  overlays.open("a");
  overlays.closeAll({ restoreFocus: false });
  assert.deepEqual(trigger.focusCalls, []);
});

test("closeAll restores focus to each surface's own opener", () => {
  const { overlays, focus, surface: register } = setup();
  const aTrigger = element("a");
  const bTrigger = element("b");
  register("a", surface());
  register("b", surface());
  focus(aTrigger);
  overlays.open("a");
  focus(bTrigger);
  overlays.open("b", { trigger: bTrigger });
  overlays.closeAll();
  assert.equal(aTrigger.focusCalls.length, 1);
  assert.equal(bTrigger.focusCalls.length, 1);
});

test("openOverlays is a snapshot, oldest first", () => {
  const { overlays, surface: register } = setup();
  register("a", surface());
  register("b", surface());
  overlays.open("a");
  overlays.open("b");

  const snapshot = overlays.openOverlays();
  assert.deepEqual(snapshot, ["a", "b"]);

  snapshot.push("mutated");
  assert.deepEqual(overlays.openOverlays(), ["a", "b"]);

  overlays.close("b");
  assert.deepEqual(snapshot, ["a", "b", "mutated"]);
  assert.deepEqual(overlays.openOverlays(), ["a"]);
});

/* Realistic sequence ---------------------------------------------------- */

test("six surfaces unwind one Escape at a time", () => {
  const names = ["month", "profile", "data", "item", "expense", "budget"];
  const { overlays, surface: register } = setup();
  names.forEach((name) => register(name, surface()));
  names.forEach((name) => overlays.open(name));

  const dismissed = [];
  let next = overlays.dismissTop();
  while (next) {
    dismissed.push(next);
    next = overlays.dismissTop();
  }

  assert.deepEqual(dismissed, [...names].reverse());
  assert.deepEqual(overlays.openOverlays(), []);
});
