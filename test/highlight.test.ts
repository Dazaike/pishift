import { describe, expect, it } from "vitest";

import { highlightMessage } from "../src/renderer/highlight";

/** Text content of the produced markup, with entities decoded. */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

describe("highlightMessage", () => {
  const samples = [
    "",
    "plain text",
    "/model gemini",
    "! ls -la",
    "# refactor this",
    "use `const x = 1` here",
    "**bold** and *not*",
    "see https://example.com/a?b=1 for detail",
    "@src/main.ts needs work",
    "open C:\\Users\\me\\notes.md and ./src/index.ts",
    "```ts\nconst a = 1;\n```",
    "a < b && c > d",
    "trailing newline\n",
    "multi\nline\ntext",
  ];

  for (const sample of samples) {
    it(`preserves every character of ${JSON.stringify(sample)}`, () => {
      // The textarea is layered over this markup, so any character added or lost
      // would misalign the caret from the glyphs beneath it. The one exception is
      // a trailing newline, which is padded so the empty last line still renders.
      const expected = sample.endsWith("\n") ? `${sample}\n` : sample;
      expect(plain(highlightMessage(sample))).toBe(expected);
    });
  }

  it("escapes HTML so pasted markup cannot inject nodes", () => {
    const html = highlightMessage('<img src=x onerror="boom">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("marks a leading slash command as a directive", () => {
    expect(highlightMessage("/tools now")).toContain('<span class="hl-directive">/tools</span>');
  });

  it("does not treat a mid-line slash as a directive", () => {
    expect(highlightMessage("run /tools")).not.toContain("hl-directive");
  });

  it("marks inline code, bold, urls, mentions and paths", () => {
    expect(highlightMessage("a `b` c")).toContain('class="hl-code"');
    expect(highlightMessage("a **b** c")).toContain('class="hl-bold"');
    expect(highlightMessage("a https://x.dev c")).toContain('class="hl-url"');
    expect(highlightMessage("a @file.ts c")).toContain('class="hl-mention"');
    expect(highlightMessage("a ./src/x.ts c")).toContain('class="hl-path"');
  });

  it("highlights an unterminated fence up to the end of the text", () => {
    const html = highlightMessage("```ts\nconst a = 1;");
    expect(html).toContain('class="hl-code"');
    expect(plain(html)).toBe("```ts\nconst a = 1;");
  });
});
