/**
 * Syntax highlighting for the composer dock.
 *
 * The dock is a transparent `<textarea>` layered over a `<pre>` that renders this
 * markup, so the returned HTML must contain exactly the same characters as the
 * input (nothing added, nothing dropped) or the caret would drift out of
 * alignment with the glyphs beneath it.
 */

import { PASTE_MARKER_RE, pasteMarkerSeq } from "../shared/paste-attach";

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (ch) => ESCAPE[ch] ?? ch);
}

/** Leading directive: omp reads `/` as a command, `!` as bash, `$` as python, `#` as a prompt action. */
const LEADING = /^\s*(?:\/[A-Za-z][\w-]*|[#!$](?=\s|$))/;

const TOKENS = new RegExp(
  [
    `(?<paste>${PASTE_MARKER_RE.source})`,
    "(?<fence>```[\\s\\S]*?(?:```|$))",
    "(?<code>`[^`\\n]+`)",
    "(?<bold>\\*\\*[^*\\n]+\\*\\*)",
    "(?<url>https?://[^\\s<>()]+)",
    "(?<mention>@[^\\s<>]+)",
    "(?<path>(?:[A-Za-z]:[\\\\/]|~[\\\\/]|\\.{1,2}[\\\\/])[^\\s<>\"']+)",
  ].join("|"),
  "g",
);

const CLASS: Record<string, string> = {
  fence: "hl-code",
  paste: "hl-paste",
  code: "hl-code",
  bold: "hl-bold",
  url: "hl-url",
  mention: "hl-mention",
  path: "hl-path",
};

/** Highlighted HTML for `text`, character-for-character identical to the source. */
export function highlightMessage(text: string): string {
  let out = "";
  let rest = text;
  let offset = 0;

  const leading = LEADING.exec(text);
  if (leading) {
    out += `<span class="hl-directive">${escapeHtml(leading[0])}</span>`;
    offset = leading[0].length;
    rest = text.slice(offset);
  }

  TOKENS.lastIndex = 0;
  let last = 0;
  for (let match = TOKENS.exec(rest); match; match = TOKENS.exec(rest)) {
    const groups = match.groups ?? {};
    const name = Object.keys(groups).find((key) => groups[key] !== undefined);
    if (!name) continue;
    out += escapeHtml(rest.slice(last, match.index));
    const attrs =
      name === "paste" ? ` data-seq="${pasteMarkerSeq(match[0]) ?? ""}"` : "";
    out += `<span class="${CLASS[name]}"${attrs}>${escapeHtml(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  out += escapeHtml(rest.slice(last));

  // A trailing newline in a <pre> is not rendered; the textarea shows a line there.
  return text.endsWith("\n") ? `${out}\n` : out;
}
