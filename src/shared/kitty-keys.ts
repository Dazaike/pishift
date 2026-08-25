/**
 * Enhanced-key encoder for the chords xterm.js cannot represent.
 *
 * omp first probes the kitty keyboard protocol (`CSI ? u`) and pushes flags with
 * `CSI > <flags> u` if the terminal answers; when the probe goes unanswered — or
 * when the answer does not satisfy it — it enables modifyOtherKeys with
 * `CSI > 4 ; 2 m` instead. xterm.js implements neither, so chords like
 * `Ctrl+Shift+O` reach the PTY as nothing at all. This module encodes exactly
 * that gap in whichever protocol omp actually turned on, and defers everything
 * the legacy VT encoder already expresses — encoding a chord xterm.js handles
 * (e.g. `Ctrl+V` -> 0x16) would break it.
 */

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const SHIFT = 1;
const ALT = 2;
const CTRL = 4;
const META = 8;

/** Keys xterm.js already encodes with modifiers as `CSI 1;<m><final>`. */
const LEGACY_MODIFIED: Record<string, true> = {
  ArrowUp: true,
  ArrowDown: true,
  ArrowLeft: true,
  ArrowRight: true,
  Home: true,
  End: true,
  PageUp: true,
  PageDown: true,
  Insert: true,
  Delete: true,
};

const ARROW_FINAL: Record<string, string> = {
  ArrowUp: "A",
  ArrowDown: "B",
  ArrowRight: "C",
  ArrowLeft: "D",
};

/** Keys that carry no character of their own. */
const MODIFIER_KEYS: Record<string, true> = {
  Shift: true,
  Control: true,
  Alt: true,
  Meta: true,
  CapsLock: true,
  NumLock: true,
  ScrollLock: true,
  AltGraph: true,
  Dead: true,
  Unidentified: true,
  OS: true,
  Hyper: true,
  Super: true,
  Fn: true,
  FnLock: true,
};

/** Functional keys with a kitty numeric code. */
const FUNCTIONAL: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Backspace: 127,
  Escape: 27,
  " ": 32,
};

/** Ctrl+<char> combinations the legacy encoder maps to a C0 control byte. */
const LEGACY_CTRL_CHAR: Record<string, true> = {
  "@": true,
  "[": true,
  "\\": true,
  "]": true,
  "^": true,
  _: true,
  " ": true,
  "?": true,
};

/** Ctrl+<key> non-printables the legacy encoder already distinguishes. */
const LEGACY_CTRL_KEY: Record<string, true> = {
  Escape: true,
};

function isFunctionKey(key: string): boolean {
  return /^F\d{1,2}$/.test(key);
}

/** Codepoint of the physical key with no shift applied. */
function unshiftedCodepoint(ev: KeyLike): number | null {
  const code = ev.code ?? "";
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3) + 32;
  if (/^Digit\d$/.test(code)) return code.charCodeAt(5);
  if (ev.key.length === 1) {
    const ch = /[A-Za-z]/.test(ev.key) ? ev.key.toLowerCase() : ev.key;
    return ch.codePointAt(0) ?? null;
  }
  return null;
}

export function modifierMask(ev: KeyLike): number {
  return (
    (ev.shiftKey ? SHIFT : 0) |
    (ev.altKey ? ALT : 0) |
    (ev.ctrlKey ? CTRL : 0) |
    (ev.metaKey ? META : 0)
  );
}

/**
 * Encode arrow keys (optionally modified) as CSI / SS3 sequences.
 * Used when the dock has focus so xterm never sees the event.
 * `application`: DECCKM on → SS3 (`ESC O A`); off → CSI (`ESC [ A`).
 */
export function encodeArrow(ev: KeyLike, application = false): string | null {
  const final = ARROW_FINAL[ev.key];
  if (!final) return null;
  const mask = modifierMask(ev);
  // Modified arrows always use CSI 1;<1+mask><final> (alt=3, shift+alt=4, …).
  if (mask !== 0) return `\x1b[1;${1 + mask}${final}`;
  // Unmodified: application cursor keys vs normal.
  return application ? `\x1bO${final}` : `\x1b[${final}`;
}

/**
 * Which enhanced-key protocol omp has switched on.
 * `legacy` means neither, so nothing may be encoded here.
 */
export type KeyMode = "legacy" | "kitty" | "modifyOtherKeys";

/** Bytes to write for `ev`, or `null` meaning "let xterm.js encode this". */
export function encodeKey(ev: KeyLike, mode: KeyMode): string | null {
  if (mode === "legacy") return null;

  const key = ev.key;
  if (!key || MODIFIER_KEYS[key]) return null;

  const mask = modifierMask(ev);
  if (mask === 0) return null;

  // Arrows / navigation / function keys already carry modifiers in legacy VT.
  if (LEGACY_MODIFIED[key] || isFunctionKey(key)) return null;

  const printable = key.length === 1;

  // Shift alone folds into the produced character — except Enter, where xterm.js
  // emits a bare CR and the chord would be indistinguishable from a submit.
  if (mask === SHIFT && key !== "Enter") return null;

  // Alt / Alt+Shift on a printable key: xterm.js emits ESC + char.
  if ((mask === ALT || mask === (ALT | SHIFT)) && printable) return null;

  // Ctrl alone maps onto the legacy C0 controls for letters and a few chars.
  if (mask === CTRL) {
    if (printable && (/^[A-Za-z]$/.test(key) || LEGACY_CTRL_CHAR[key])) return null;
    if (LEGACY_CTRL_KEY[key]) return null;
  }

  const code: number | undefined = FUNCTIONAL[key] ?? unshiftedCodepoint(ev) ?? undefined;
  if (code === undefined) return null;

  return mode === "kitty"
    ? `\x1b[${code};${1 + mask}u`
    : `\x1b[27;${1 + mask};${code}~`;
}
