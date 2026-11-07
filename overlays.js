/**
 * overlays.js — one lifecycle for dismissible surfaces.
 *
 * The module owns *when* a surface is open and *how* it is dismissed: the
 * stack, one-close-per-Escape, outside-click rules, and returning focus to
 * whatever opened it. It does not own any surface's markup or animation.
 *
 * Each surface registers a small adapter:
 *   show()             make the surface visible (and focus what it should)
 *   hide()             make it invisible and tear down transient state
 *   isOutsideClick(t)  true when a pointer target should dismiss it
 *   dismissible        false to keep it open on Escape/outside click
 *   onDismiss(event)   return false to consume Escape without closing
 *   restoreFocus       false to leave focus alone (defaults to true)
 *
 * Dismissals caused by a pointer outside the surface do not pull focus back;
 * the click already moved it where the user wanted. Keyboard and explicit
 * closes do restore focus to the opener.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Overlays = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create({ activeElement } = {}) {
    const adapters = new Map();
    const triggers = new Map();
    const stack = [];
    const getActive = typeof activeElement === "function" ? activeElement : () => null;

    function register(name, adapter) {
      if (typeof name !== "string" || name === "") {
        throw new TypeError("overlays: a name is required");
      }
      if (!adapter || typeof adapter.show !== "function" || typeof adapter.hide !== "function") {
        throw new TypeError(`overlays: ${name} needs show and hide adapters`);
      }
      adapters.set(name, adapter);
    }

    function isOpen(name) {
      return stack.includes(name);
    }

    function open(name, options = {}) {
      const adapter = adapters.get(name);
      if (!adapter || isOpen(name)) return false;
      triggers.set(name, options.trigger !== undefined ? options.trigger : getActive());
      stack.push(name);
      try {
        adapter.show();
      } catch (error) {
        stack.pop();
        triggers.delete(name);
        throw error;
      }
      return true;
    }

    function close(name, options = {}) {
      const adapter = adapters.get(name);
      if (!adapter) return false;
      const index = stack.lastIndexOf(name);
      if (index === -1) return false;

      stack.splice(index, 1);
      const trigger = triggers.get(name);
      triggers.delete(name);
      adapter.hide();

      const restore = options.restoreFocus !== undefined
        ? options.restoreFocus
        : adapter.restoreFocus !== false;
      if (restore && trigger && typeof trigger.focus === "function") {
        trigger.focus({ preventScroll: true });
      }
      return true;
    }

    function toggle(name, options = {}) {
      if (isOpen(name)) {
        close(name, options);
        return false;
      }
      return open(name, options);
    }

    /** Close the most recently opened dismissible surface. */
    function dismissTop(event) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const name = stack[index];
        const adapter = adapters.get(name);
        if (!adapter || adapter.dismissible === false) continue;
        if (typeof adapter.onDismiss === "function" && adapter.onDismiss(event) === false) {
          return null;
        }
        close(name);
        return name;
      }
      return null;
    }

    /** Close every open surface the pointer landed outside of. */
    function dismissOutside(target) {
      const closed = [];
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const name = stack[index];
        const adapter = adapters.get(name);
        if (!adapter || adapter.dismissible === false) continue;
        if (typeof adapter.isOutsideClick === "function" && !adapter.isOutsideClick(target)) {
          continue;
        }
        close(name, { restoreFocus: false });
        closed.push(name);
      }
      return closed;
    }

    function closeAll(options = {}) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        close(stack[index], options);
      }
    }

    /** Snapshot of open names, oldest first. */
    function openOverlays() {
      return stack.slice();
    }

    return {
      register,
      isOpen,
      open,
      close,
      toggle,
      dismissTop,
      dismissOutside,
      closeAll,
      openOverlays,
    };
  }

  return { create };
});
