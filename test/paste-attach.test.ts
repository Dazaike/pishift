import { describe, expect, it } from "vitest";
import {
  PASTE_MARKER_STYLES,
  countPasteLines,
  describePasteKind,
  detectPasteMenu,
  isLargePaste,
  isPasteModeSetting,
  pasteMarker,
  pasteMarkerSeq,
  pasteMenuDownCount,
  renderPasteMarkersForHistory,
  splitPasteSegments,
  triggersPasteMenu,
} from "../src/shared/paste-attach";

describe("isLargePaste", () => {
  it("matches omp's line boundary", () => {
    expect(isLargePaste("x\n".repeat(9) + "x")).toBe(false); // 10 lines
    expect(isLargePaste("x\n".repeat(10) + "x")).toBe(true); // 11 lines
  });

  it("matches omp's character boundary", () => {
    expect(isLargePaste("a".repeat(1000))).toBe(false);
    expect(isLargePaste("a".repeat(1001))).toBe(true);
  });
});

describe("countPasteLines", () => {
  it("normalizes CRLF and lone CR", () => {
    expect(countPasteLines("a\r\nb\rc")).toBe(3);
  });

  it("counts the empty line a trailing newline creates", () => {
    expect(countPasteLines("a\nb\n")).toBe(3);
  });
});

describe("triggersPasteMenu", () => {
  it("uses omp's default largeMenuThreshold of 100", () => {
    expect(triggersPasteMenu(99)).toBe(false);
    expect(triggersPasteMenu(100)).toBe(true);
  });
});

describe("pasteMenuDownCount", () => {
  it("maps each mode to omp's selector row", () => {
    expect(pasteMenuDownCount("wrapped")).toBe(0);
    expect(pasteMenuDownCount("file")).toBe(1);
    expect(pasteMenuDownCount("inline")).toBe(2);
  });
});

describe("pasteMarker + pasteMarkerSeq", () => {
  it("round-trips the sequence number in every style", () => {
    for (const style of PASTE_MARKER_STYLES) {
      expect(pasteMarkerSeq(pasteMarker(12, style, "a\nb"))).toBe(12);
    }
  });

  it("names the content in the content style", () => {
    expect(pasteMarker(1, "content", "// ==UserScript==\nx")).toBe(
      "⧉1 UserScript · 2 ln",
    );
  });

  it("uses superscript digits for the footnote style", () => {
    expect(pasteMarker(10, "footnote")).toBe("paste¹⁰");
  });
});

describe("describePasteKind", () => {
  it("classifies the pastes the marker vocabulary covers", () => {
    expect(describePasteKind("// ==UserScript==\n// @name x")).toBe("UserScript");
    expect(describePasteKind('{"a": 1}')).toBe("JSON");
    expect(describePasteKind("diff --git a/x b/x\n@@ -1 +1 @@")).toBe("diff");
    expect(describePasteKind("<!DOCTYPE html>\n<html>")).toBe("HTML");
    expect(describePasteKind("# Title\n\nbody")).toBe("markdown");
    expect(describePasteKind("2026-08-28 ERROR boom")).toBe("log");
    expect(describePasteKind("import x from 'y';")).toBe("code");
    expect(describePasteKind("just some prose")).toBe("text");
  });
});

describe("splitPasteSegments", () => {
  const marker = (seq: number): string => pasteMarker(seq, "brackets");

  it("returns a lone paste for a marker-only body", () => {
    expect(splitPasteSegments(marker(1), new Set([1]))).toEqual([
      { kind: "paste", seq: 1 },
    ]);
  });

  it("preserves surrounding whitespace verbatim", () => {
    expect(splitPasteSegments(`look at ${marker(2)} please`, new Set([2]))).toEqual([
      { kind: "text", text: "look at " },
      { kind: "paste", seq: 2 },
      { kind: "text", text: " please" },
    ]);
  });

  it("emits no empty text segment between adjacent markers", () => {
    expect(splitPasteSegments(`${marker(1)}${marker(2)}`, new Set([1, 2]))).toEqual([
      { kind: "paste", seq: 1 },
      { kind: "paste", seq: 2 },
    ]);
  });

  it("mixes styles in one body", () => {
    const body = `${pasteMarker(1, "footnote")} and ${pasteMarker(2, "local")}`;
    expect(splitPasteSegments(body, new Set([1, 2]))).toEqual([
      { kind: "paste", seq: 1 },
      { kind: "text", text: " and " },
      { kind: "paste", seq: 2 },
    ]);
  });

  it("leaves an unknown marker as literal text", () => {
    const body = `a ${marker(7)} b`;
    expect(splitPasteSegments(body, new Set([1]))).toEqual([{ kind: "text", text: body }]);
  });

  it("returns nothing for an empty body", () => {
    expect(splitPasteSegments("", new Set())).toEqual([]);
  });
});

describe("renderPasteMarkersForHistory", () => {
  it("collapses markers the way omp displays them", () => {
    expect(renderPasteMarkersForHistory(`a ${pasteMarker(3, "dot")} b`)).toBe("a #3 b");
    expect(renderPasteMarkersForHistory(`a ${pasteMarker(3, "footnote")} b`)).toBe("a #3 b");
  });
});

describe("detectPasteMenu", () => {
  it("recognizes omp's selector once ANSI is stripped", () => {
    const plain = [
      "Pasted 988 lines",
      "> Attach as a wrapped block",
      "  Wrap the text in <attachment> tags, collapsed to a marker",
      "  Attach as local file",
      "  Paste inline",
      "Esc to paste inline",
    ].join("\n");
    expect(detectPasteMenu(plain)).toBe(true);
    expect(detectPasteMenu("nothing to see here")).toBe(false);
  });
});

describe("isPasteModeSetting", () => {
  it("accepts only the four persisted values", () => {
    expect(isPasteModeSetting("ask")).toBe(true);
    expect(isPasteModeSetting("wrapped")).toBe(true);
    expect(isPasteModeSetting("file")).toBe(true);
    expect(isPasteModeSetting("inline")).toBe(true);
    expect(isPasteModeSetting("nope")).toBe(false);
    expect(isPasteModeSetting(undefined)).toBe(false);
  });
});
