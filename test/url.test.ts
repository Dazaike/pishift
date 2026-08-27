import { describe, expect, it } from "vitest";
import { isSafeExternalUrl } from "../src/shared/url";

describe("isSafeExternalUrl", () => {
  it("accepts valid http and https URLs", () => {
    expect(isSafeExternalUrl("https://example.com")).toBe(true);
    expect(isSafeExternalUrl("http://localhost:3000/path?query=1#hash")).toBe(true);
    expect(isSafeExternalUrl("HTTPS://GITHUB.COM/FOO/BAR")).toBe(true);
  });

  it("accepts valid mailto URLs", () => {
    expect(isSafeExternalUrl("mailto:test@example.com")).toBe(true);
  });

  it("rejects about: links including about:blank", () => {
    expect(isSafeExternalUrl("about:blank")).toBe(false);
    expect(isSafeExternalUrl("about:srcdoc")).toBe(false);
    expect(isSafeExternalUrl("about:")).toBe(false);
  });

  it("rejects dangerous pseudo-schemes and local files", () => {
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("data:text/html,<h1>hi</h1>")).toBe(false);
    expect(isSafeExternalUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(isSafeExternalUrl("chrome://settings")).toBe(false);
  });

  it("rejects invalid or empty inputs", () => {
    expect(isSafeExternalUrl("")).toBe(false);
    expect(isSafeExternalUrl("   ")).toBe(false);
    expect(isSafeExternalUrl("not-a-url")).toBe(false);
    expect(isSafeExternalUrl(null as unknown as string)).toBe(false);
  });
});
