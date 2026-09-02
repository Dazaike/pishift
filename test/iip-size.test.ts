import { describe, expect, it } from "vitest";

import { createIipState, injectIipSize, takeIipBuffer } from "../src/shared/iip-size";

const BEL = "\x07";

describe("injectIipSize", () => {
  it("prepends the decoded byte length for a BEL-terminated sequence", () => {
    const state = createIipState();
    const input = `\x1b]1337;File=inline=1;width=40;height=auto:aGVsbG8=${BEL}`;
    expect(injectIipSize(state, input)).toBe(
      `\x1b]1337;File=size=5;inline=1;width=40;height=auto:aGVsbG8=${BEL}`,
    );
    expect(state.buf).toBe("");
  });

  it("handles the ST terminator", () => {
    const state = createIipState();
    const input = "\x1b]1337;File=inline=1;width=2;height=auto:aGVsbG8=\x1b\\";
    expect(injectIipSize(state, input)).toBe(
      "\x1b]1337;File=size=5;inline=1;width=2;height=auto:aGVsbG8=\x1b\\",
    );
  });

  it("reassembles a sequence split across three chunks", () => {
    const state = createIipState();
    const chunks = [
      "before\x1b]1337;File=inl",
      "ine=1;width=10;height=auto:aGVs",
      `bG8=${BEL}after`,
    ];
    const out = chunks.map((chunk) => injectIipSize(state, chunk)).join("");
    expect(out).toBe(
      `before\x1b]1337;File=size=5;inline=1;width=10;height=auto:aGVsbG8=${BEL}after`,
    );
    expect(state.buf).toBe("");
  });

  it("retains a partial marker at a chunk boundary", () => {
    const state = createIipState();
    expect(injectIipSize(state, "text\x1b]13")).toBe("text");
    expect(state.buf).toBe("\x1b]13");
    expect(injectIipSize(state, `37;File=inline=1:aGk=${BEL}`)).toBe(
      `\x1b]1337;File=size=2;inline=1:aGk=${BEL}`,
    );
  });

  it("computes the length of unpadded base64", () => {
    const state = createIipState();
    // "aGVsbG8" decodes to 5 bytes; "YWJjZA" to 4.
    expect(injectIipSize(state, `\x1b]1337;File=inline=1:aGVsbG8${BEL}`)).toBe(
      `\x1b]1337;File=size=5;inline=1:aGVsbG8${BEL}`,
    );
    expect(injectIipSize(state, `\x1b]1337;File=inline=1:YWJjZA${BEL}`)).toBe(
      `\x1b]1337;File=size=4;inline=1:YWJjZA${BEL}`,
    );
  });

  it("leaves a sequence that already declares size= untouched", () => {
    const state = createIipState();
    const input = `\x1b]1337;File=size=99;inline=1:aGVsbG8=${BEL}`;
    expect(injectIipSize(state, input)).toBe(input);
  });

  it("passes interleaved plain text through byte-identically", () => {
    const state = createIipState();
    const input = `pre \x1b[31mred\x1b[0m \x1b]1337;File=inline=1:aGk=${BEL} post\r\n`;
    expect(injectIipSize(state, input)).toBe(
      `pre \x1b[31mred\x1b[0m \x1b]1337;File=size=2;inline=1:aGk=${BEL} post\r\n`,
    );
  });

  it("rewrites two sequences in one chunk", () => {
    const state = createIipState();
    const one = `\x1b]1337;File=inline=1:aGk=${BEL}`;
    const two = `\x1b]1337;File=inline=1:YWJjZA==${BEL}`;
    expect(injectIipSize(state, one + two)).toBe(
      `\x1b]1337;File=size=2;inline=1:aGk=${BEL}\x1b]1337;File=size=4;inline=1:YWJjZA==${BEL}`,
    );
  });

  it("handles base64 payloads with internal whitespace and newlines", () => {
    const state = createIipState();
    const input = `\x1b]1337;File=inline=1:aGVs\r\nbG8=\n${BEL}`;
    expect(injectIipSize(state, input)).toBe(
      `\x1b]1337;File=size=5;inline=1:aGVs\r\nbG8=\n${BEL}`,
    );
  });

  it("returns empty string while buffering partial sequence chunks", () => {
    const state = createIipState();
    expect(injectIipSize(state, "\x1b]1337;File=inline=1:aGVs")).toBe("");
    expect(state.buf).toBe("\x1b]1337;File=inline=1:aGVs");
    expect(injectIipSize(state, `bG8=${BEL}`)).toBe(
      `\x1b]1337;File=size=5;inline=1:aGVsbG8=${BEL}`,
    );
  });

  it("passes a malformed sequence with no payload separator through unchanged", () => {
    const state = createIipState();
    const input = `\x1b]1337;File=inline=1${BEL}`;
    expect(injectIipSize(state, input)).toBe(input);
  });
});

describe("takeIipBuffer", () => {
  it("releases withheld bytes verbatim and empties the state", () => {
    const state = createIipState();
    const partial = "\x1b]1337;File=inline=1:aGVs";
    expect(injectIipSize(state, partial)).toBe("");
    expect(takeIipBuffer(state)).toBe(partial);
    expect(state.buf).toBe("");
    expect(takeIipBuffer(state)).toBe("");
  });

  it("leaves the transformer usable for the next sequence after a flush", () => {
    const state = createIipState();
    injectIipSize(state, "\x1b]1337;File=inline=1:aGVs");
    takeIipBuffer(state);
    // The tail of the flushed sequence carries no marker, so it passes through.
    expect(injectIipSize(state, `bG8=${BEL}`)).toBe(`bG8=${BEL}`);
    expect(injectIipSize(state, `\x1b]1337;File=inline=1:aGVsbG8=${BEL}`)).toBe(
      `\x1b]1337;File=size=5;inline=1:aGVsbG8=${BEL}`,
    );
  });
});
