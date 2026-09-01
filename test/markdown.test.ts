import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/shared/markdown";

describe("renderMarkdown", () => {
  it("escapes HTML before emitting any markup", () => {
    const out = renderMarkdown("<script>alert(1)</script>");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;");
  });

  it("escapes HTML inside a fenced block and preserves its body", () => {
    const out = renderMarkdown("```ts\nconst a = 1 < 2 && 3 > 2;\n```");
    expect(out).toContain('<pre class="md-pre" data-lang="ts"><code>');
    expect(out).toContain("const a = 1 &lt; 2 &amp;&amp; 3 &gt; 2;");
    expect(out).not.toContain("<code>const a = 1 < 2");
  });

  it("refuses non-http link targets", () => {
    const out = renderMarkdown("[x](javascript:alert(1))");
    expect(out).not.toContain("href");
    expect(out).toContain("[x](javascript:alert(1))");
  });

  it("links http targets and opens them out of process", () => {
    const out = renderMarkdown("[docs](https://example.com/a)");
    expect(out).toContain('href="https://example.com/a"');
    expect(out).toContain('rel="noreferrer"');
  });

  it("renders pipe tables only when a divider row follows", () => {
    expect(renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |")).toContain('<table class="md-table">');
    expect(renderMarkdown("a | b\nplain text")).not.toContain("<table");
  });

  it("renders inline emphasis and code spans", () => {
    const out = renderMarkdown("**bold** and `code` and *em*");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain('<code class="md-code">code</code>');
    expect(out).toContain("<em>em</em>");
  });

  it("does not interpret markup inside a code span", () => {
    expect(renderMarkdown("`**not bold**`")).toContain('<code class="md-code">**not bold**</code>');
  });

  it("renders headings, lists and blockquotes", () => {
    expect(renderMarkdown("## Title")).toBe('<h2 class="md-h">Title</h2>');
    expect(renderMarkdown("- a\n- b")).toBe('<ul class="md-list"><li>a</li><li>b</li></ul>');
    expect(renderMarkdown("> quoted")).toBe('<blockquote class="md-quote">quoted</blockquote>');
  });

  it("returns an empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });
});
