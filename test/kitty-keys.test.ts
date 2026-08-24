import { describe, expect, it } from "vitest";

import { encodeKey, type KeyLike } from "../src/shared/kitty-keys";

type Mods = { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };

function key(k: string, code?: string, mods: Mods = {}): KeyLike {
  return {
    key: k,
    code,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    metaKey: !!mods.meta,
  };
}

/** [name, event, kitty encoding, modifyOtherKeys encoding] */
const ENCODED: [string, KeyLike, string, string][] = [
  ["Ctrl+Shift+O", key("O", "KeyO", { ctrl: true, shift: true }), "\x1b[111;6u", "\x1b[27;6;111~"],
  ["Ctrl+Shift+P", key("P", "KeyP", { ctrl: true, shift: true }), "\x1b[112;6u", "\x1b[27;6;112~"],
  ["Ctrl+Shift+V", key("V", "KeyV", { ctrl: true, shift: true }), "\x1b[118;6u", "\x1b[27;6;118~"],
  ["Ctrl+Enter", key("Enter", "Enter", { ctrl: true }), "\x1b[13;5u", "\x1b[27;5;13~"],
  ["Shift+Enter", key("Enter", "Enter", { shift: true }), "\x1b[13;2u", "\x1b[27;2;13~"],
  [
    "Ctrl+Backspace",
    key("Backspace", "Backspace", { ctrl: true }),
    "\x1b[127;5u",
    "\x1b[27;5;127~",
  ],
  ["Ctrl+Tab", key("Tab", "Tab", { ctrl: true }), "\x1b[9;5u", "\x1b[27;5;9~"],
  ["Ctrl+Alt+M", key("m", "KeyM", { ctrl: true, alt: true }), "\x1b[109;7u", "\x1b[27;7;109~"],
  ["Ctrl+1", key("1", "Digit1", { ctrl: true }), "\x1b[49;5u", "\x1b[27;5;49~"],
];

const DEFERRED: [string, KeyLike][] = [
  ["plain a", key("a", "KeyA")],
  ["Ctrl+V", key("v", "KeyV", { ctrl: true })],
  ["Ctrl+C", key("c", "KeyC", { ctrl: true })],
  ["Shift+Tab", key("Tab", "Tab", { shift: true })],
  ["Alt+M", key("m", "KeyM", { alt: true })],
  ["Ctrl+ArrowLeft", key("ArrowLeft", "ArrowLeft", { ctrl: true })],
  ["F5", key("F5", "F5")],
  ["Ctrl+Shift+F5", key("F5", "F5", { ctrl: true, shift: true })],
  ["Shift+A", key("A", "KeyA", { shift: true })],
  ["Ctrl+Space", key(" ", "Space", { ctrl: true })],
  ["bare Shift", key("Shift", "ShiftLeft", { shift: true })],
];

describe("encodeKey", () => {
  for (const [name, ev, kitty, legacyOther] of ENCODED) {
    it(`encodes ${name} in both protocols`, () => {
      expect(encodeKey(ev, "kitty")).toBe(kitty);
      expect(encodeKey(ev, "modifyOtherKeys")).toBe(legacyOther);
    });
  }

  for (const [name, ev] of DEFERRED) {
    it(`defers ${name} to xterm.js`, () => {
      expect(encodeKey(ev, "kitty")).toBeNull();
      expect(encodeKey(ev, "modifyOtherKeys")).toBeNull();
    });
  }

  it("encodes nothing while no enhanced protocol is active", () => {
    for (const [, ev] of ENCODED) expect(encodeKey(ev, "legacy")).toBeNull();
  });
});
