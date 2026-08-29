/**
 * Long-paste handling that mirrors omp's own large-paste behaviour.
 *
 * omp treats a paste as "large" when it exceeds 10 lines or 1000 characters,
 * and collapses it to an inline marker rather than dumping it into the editor.
 * Above `paste.largeMenuThreshold` lines (schema default 100) it first asks how
 * to attach the text. PiShift mirrors both steps in the dock so the user picks
 * before submitting, then replays the choice into omp's selector.
 */

export type PasteMode = "wrapped" | "file" | "inline";
export type PasteModeSetting = PasteMode | "ask";

export const PASTE_MODE_SETTINGS: readonly PasteModeSetting[] = [
  "ask",
  "wrapped",
  "file",
  "inline",
];

export function isPasteModeSetting(value: unknown): value is PasteModeSetting {
  return (
    typeof value === "string" &&
    (PASTE_MODE_SETTINGS as readonly string[]).includes(value)
  );
}

export const OMP_LARGE_PASTE_LINES = 10;
export const OMP_LARGE_PASTE_CHARS = 1000;
export const OMP_PASTE_MENU_LINES = 100;

/** ms budget waiting for omp's selector when we expect it. */
export const PASTE_MENU_WAIT_MS = 1500;
/** ms budget when we do not expect it (omp's threshold is configurable). */
export const PASTE_MENU_PROBE_MS = 250;
/** poll interval while waiting for the selector. */
export const PASTE_MENU_POLL_MS = 30;

/**
 * How the collapsed paste is written into the composer. Every style is a plain
 * run of characters: the highlight mirror must hold exactly the same text as
 * the textarea, so styling is paint (see PasteMarkerPaint), never extra glyphs.
 */
export const PASTE_MARKER_STYLES = [
  "content",
  "footnote",
  "brackets",
  "local",
  "dot",
] as const;
export type PasteMarkerStyle = (typeof PASTE_MARKER_STYLES)[number];

/** Purely visual treatment of the marker in the highlight mirror. */
export const PASTE_MARKER_PAINTS = ["pill", "fold", "knockout", "rail", "plain"] as const;
export type PasteMarkerPaint = (typeof PASTE_MARKER_PAINTS)[number];

export function isPasteMarkerStyle(value: unknown): value is PasteMarkerStyle {
  return (
    typeof value === "string" && (PASTE_MARKER_STYLES as readonly string[]).includes(value)
  );
}

export function isPasteMarkerPaint(value: unknown): value is PasteMarkerPaint {
  return (
    typeof value === "string" && (PASTE_MARKER_PAINTS as readonly string[]).includes(value)
  );
}

/** Closed vocabulary, so the "content" marker stays machine-recognisable. */
export const PASTE_KINDS = [
  "UserScript",
  "JSON",
  "diff",
  "markdown",
  "HTML",
  "code",
  "log",
  "text",
] as const;
export type PasteKind = (typeof PASTE_KINDS)[number];

export function describePasteKind(text: string): PasteKind {
  const head = normalizePaste(text).slice(0, 4000);
  if (/^\s*\/\/\s*==UserScript==/m.test(head)) return "UserScript";
  if (/^\s*(?:diff --git |@@ -\d|[-+]{3} [ab]\/)/m.test(head)) return "diff";
  if (/^\s*[[{]/.test(head) && /["}\]]\s*$/.test(head.trim())) return "JSON";
  if (/^\s*(?:<!DOCTYPE html|<html\b|<\?xml)/i.test(head)) return "HTML";
  if (/^#{1,6}\s+\S/m.test(head) || /^\s*```/m.test(head)) return "markdown";
  if (
    /^\s*(?:\d{4}-\d{2}-\d{2}[ T]|\[\d{2}:\d{2}:\d{2}|(?:ERROR|WARN|INFO|DEBUG|TRACE)\b)/m.test(
      head,
    )
  )
    return "log";
  if (
    /^\s*(?:import |export |function |class |const |let |var |def |package |#include|#!\/)/m.test(
      head,
    )
  )
    return "code";
  return "text";
}

const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** The composer text for one collapsed paste. */
export function pasteMarker(seq: number, style: PasteMarkerStyle, text = ""): string {
  switch (style) {
    case "content":
      return `⧉${seq} ${describePasteKind(text)} · ${countPasteLines(text)} ln`;
    case "footnote":
      return `paste${[...String(seq)].map((d) => SUPERSCRIPT_DIGITS[Number(d)]).join("")}`;
    case "brackets":
      return `⟦ paste ${seq} ⟧`;
    case "local":
      return `local://paste-${seq}.md`;
    case "dot":
      return `● paste ${seq}`;
  }
}

const MARKER_SOURCES: Record<PasteMarkerStyle, string> = {
  content: `⧉\\d+ (?:${PASTE_KINDS.join("|")}) · \\d+ ln`,
  footnote: `paste[${SUPERSCRIPT_DIGITS}]+`,
  brackets: "⟦ paste \\d+ ⟧",
  local: "local://paste-\\d+\\.md",
  dot: "● paste \\d+",
};

/** Matches a marker in any style. Global: callers must reset `lastIndex`. */
export const PASTE_MARKER_RE = new RegExp(Object.values(MARKER_SOURCES).join("|"), "g");

/** Sequence number carried by a marker, whatever style wrote it. */
export function pasteMarkerSeq(marker: string): number | null {
  const superscript = /^paste([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/.exec(marker);
  if (superscript) {
    const digits = [...superscript[1]!].map((ch) => SUPERSCRIPT_DIGITS.indexOf(ch)).join("");
    return Number(digits);
  }
  const decimal = /\d+/.exec(marker);
  return decimal ? Number(decimal[0]) : null;
}

export function normalizePaste(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function countPasteLines(text: string): number {
  return normalizePaste(text).split("\n").length;
}

export function isLargePaste(text: string): boolean {
  return (
    countPasteLines(text) > OMP_LARGE_PASTE_LINES ||
    text.length > OMP_LARGE_PASTE_CHARS
  );
}

export function triggersPasteMenu(lines: number): boolean {
  return lines >= OMP_PASTE_MENU_LINES;
}

/** Every marker occurrence in `body`, in document order. */
export function findPasteMarkers(body: string): { seq: number; start: number; end: number }[] {
  const found: { seq: number; start: number; end: number }[] = [];
  const re = new RegExp(PASTE_MARKER_RE.source, "g");
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const seq = pasteMarkerSeq(m[0]);
    if (seq === null) continue;
    found.push({ seq, start: m.index, end: m.index + m[0].length });
  }
  return found;
}

/** Rows in omp's selector, in order. Answering = that many ArrowDown presses. */
export function pasteMenuDownCount(mode: PasteMode): number {
  switch (mode) {
    case "wrapped":
      return 0;
    case "file":
      return 1;
    case "inline":
      return 2;
  }
}

/**
 * omp's selector, seen in the ANSI-stripped terminal stream. The header is
 * matched too: a narrow terminal can reflow the option row, but "Pasted N
 * lines" always fits.
 */
export function detectPasteMenu(plain: string): boolean {
  return plain.includes("Attach as a wrapped block") || /Pasted \d+ lines/.test(plain);
}

export type PasteSegment =
  | { kind: "text"; text: string }
  | { kind: "paste"; seq: number };

/**
 * Splits a composer body into literal text and paste markers.
 *
 * Markers whose sequence number has no live paste (a recalled history entry,
 * say) stay literal text so nothing silently disappears.
 */
export function splitPasteSegments(
  body: string,
  known: ReadonlySet<number>,
): PasteSegment[] {
  const segments: PasteSegment[] = [];
  let cursor = 0;

  for (const marker of findPasteMarkers(body)) {
    if (!known.has(marker.seq)) continue;
    if (marker.start > cursor) {
      segments.push({ kind: "text", text: body.slice(cursor, marker.start) });
    }
    segments.push({ kind: "paste", seq: marker.seq });
    cursor = marker.end;
  }

  if (cursor < body.length) {
    segments.push({ kind: "text", text: body.slice(cursor) });
  }
  return segments;
}

/** Marker -> `#N`, matching how omp renders a collapsed paste in history. */
export function renderPasteMarkersForHistory(body: string): string {
  return body.replace(
    new RegExp(PASTE_MARKER_RE.source, "g"),
    (marker) => `#${pasteMarkerSeq(marker) ?? "?"}`,
  );
}
