/**
 * Minimal markdown → HTML for the chat view.
 *
 * Written by hand rather than pulled in as a dependency: the app ships only
 * `animejs` and `node-pty` at runtime, and the subset agents actually emit is
 * small. `src/renderer/highlight.ts` is not reusable here — it is a
 * character-preserving inline highlighter for the composer's textarea overlay.
 *
 * Security: the source is HTML-escaped *before* any markup is generated, so no
 * transcript content can reach the DOM as markup. Every tag in the output is
 * emitted by this file. Link targets are additionally scheme-checked, since an
 * escaped `javascript:` URL is still dangerous inside an `href`.
 */

/** Schemes allowed in a rendered link. Anything else renders as literal text. */
const SAFE_HREF = /^(?:https?|file):/i;

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ESCAPES[ch]);
}

/** Inline spans, applied to already-escaped text. Order matters: code wins first. */
function inline(escaped: string): string {
  let out = escaped;

  // Code spans are opaque: nothing inside them is further interpreted. Their
  // content is stashed behind a placeholder so later passes cannot reach it.
  const codes: string[] = [];
  out = out.replace(/`([^`\n]+)`/g, (_m, body: string) => {
    codes.push(body);
    return `\u0000${codes.length - 1}\u0000`;
  });

  out = out.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    // `&amp;` from the escape pass must be undone before the scheme test, or a
    // crafted `java&#x73;cript:` style target could slip past it.
    const raw = href.replace(/&amp;/g, "&");
    if (!SAFE_HREF.test(raw)) return match;
    return `<a class="md-link" href="${raw}" target="_blank" rel="noreferrer">${label || raw}</a>`;
  });

  out = out.replace(
    /(^|[\s(])(https?:\/\/[^\s<>"')]+)/g,
    (_m, lead: string, url: string) =>
      `${lead}<a class="md-link" href="${url}" target="_blank" rel="noreferrer">${url}</a>`,
  );

  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<em>$2</em>");

  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code class="md-code">${codes[Number(i)]}</code>`);
}

/** Split a pipe-table row into cells, tolerating optional leading/trailing pipes. */
function tableCells(line: string): string[] {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}

const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function renderMarkdown(src: string): string {
  if (!src) return "";

  const lines = escapeHtml(src).split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join("<br>"))}</p>`);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = /^\s*```(\S*)/.exec(line);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      const lang = fence[1] ? ` data-lang="${fence[1]}"` : "";
      out.push(`<pre class="md-pre"${lang}><code>${body.join("\n")}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      out.push(`<h${level} class="md-h">${inline(heading[2].trim())}</h${level}>`);
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(line)) {
      flushParagraph();
      out.push('<hr class="md-hr">');
      continue;
    }

    if (/^\s*&gt;\s?/.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*&gt;\s?/, ""));
        i++;
      }
      i--;
      out.push(`<blockquote class="md-quote">${inline(quoted.join("<br>"))}</blockquote>`);
      continue;
    }

    // A pipe table needs its `|---|` divider on the very next line; without it
    // the text is just prose that happens to contain pipes.
    if (line.includes("|") && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      flushParagraph();
      const head = tableCells(line).map((c) => `<th>${inline(c)}</th>`).join("");
      i += 2;
      const body: string[] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        body.push(`<tr>${tableCells(lines[i]).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`);
        i++;
      }
      i--;
      out.push(`<table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body.join("")}</tbody></table>`);
      continue;
    }

    const bullet = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      const ordered = /\d/.test(bullet[2]);
      const items: string[] = [];
      let nested: string[] = [];

      const flushNested = (): void => {
        if (!nested.length) return;
        items.push(`<ul class="md-list">${nested.join("")}</ul>`);
        nested = [];
      };

      while (i < lines.length) {
        const item = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!item) break;
        if (item[1].length >= 2) {
          nested.push(`<li>${inline(item[3])}</li>`);
        } else {
          flushNested();
          items.push(`<li>${inline(item[3])}</li>`);
        }
        i++;
      }
      i--;
      flushNested();
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag} class="md-list">${items.join("")}</${tag}>`);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return out.join("");
}
