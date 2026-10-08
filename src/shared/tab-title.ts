const DECORATION = /^(?:\u03c0(?=\s|$)|[\u2800-\u28ff]+)\s*/u;

/** Removes omp's "π" prefix and braille spinner frames from the START of a terminal title. */
export function stripOmpTitleDecoration(title: string): string {
  let t = title.trimStart();
  for (;;) {
    const next = t.replace(DECORATION, "");
    if (next === t) break;
    t = next;
  }
  return t.trim();
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function firstGrapheme(text: string): string {
  for (const seg of segmenter.segment(text)) return seg.segment;
  return "";
}

const EMOJI_START = /^(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic})/u;
const EMOJI_RENDER = /[\p{Emoji_Presentation}\uFE0F\u20E3\p{Regional_Indicator}]/u;

/**
 * Splits a tab name into an optional leading emoji (shown as the row icon), the remaining label
 * text, and the glyph to draw in the icon cell (the emoji, else the first letter, else a bullet).
 */
export function splitTabName(name: string): { icon: string | null; text: string; glyph: string } {
  const trimmed = name.trim();
  const g = firstGrapheme(trimmed);
  if (EMOJI_START.test(g) && EMOJI_RENDER.test(g)) {
    const rest = trimmed.slice(g.length).trimStart();
    return { icon: g, text: rest === "" ? trimmed : rest, glyph: g };
  }
  return { icon: null, text: trimmed, glyph: firstGrapheme(trimmed).toUpperCase() || "\u2022" };
}
