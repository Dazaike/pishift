/**
 * Regenerate `src/shared/slash-commands.ts` from an omp binary.
 *
 * omp's bundle keeps its slash-command registry as readable source, so the
 * authoritative list can be lifted straight out of the executable instead of
 * being transcribed by hand and going stale on every omp release.
 *
 *   node scripts/extract-slash-commands.mjs [path-to-omp.exe]
 */
import { closeSync, openSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const exe =
  process.argv[2] ??
  join(process.env.LOCALAPPDATA ?? "", "omp", process.platform === "win32" ? "omp.exe" : "omp");

const CHUNK = 32 * 1024 * 1024;
const OVERLAP = 8192;
/** How far past a `name:` a registry entry's metadata can reach. */
const WINDOW = 2200;

const NAME = /name: "([a-z][\w:.-]*)",/g;
const DESCRIPTION = /description: "((?:[^"\\]|\\.)*)"/;
const HINT = /inlineHint: "((?:[^"\\]|\\.)*)"/;
const HANDLER = /\b(?:handleTui|handleAcp|handle): /;
const ALLOW_ARGS = /allowArgs: (?:true|!0|!1)/;
/** Protobuf field descriptors share the `name:` shape but are not commands. */
const PROTOBUF_FIELD = /\{\s*no: \d+,\s*$/;

function* chunks(path) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(CHUNK);
    let pos = 0;
    let tail = "";
    for (;;) {
      const read = readSync(fd, buf, 0, CHUNK, pos);
      if (read === 0) break;
      pos += read;
      const text = tail + buf.toString("latin1", 0, read);
      yield text;
      tail = text.slice(-OVERLAP);
    }
  } finally {
    closeSync(fd);
  }
}

const commands = new Map();

for (const text of chunks(exe)) {
  NAME.lastIndex = 0;
  for (let m = NAME.exec(text); m; m = NAME.exec(text)) {
    const name = m[1];
    if (commands.has(name)) continue;
    if (PROTOBUF_FIELD.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
    // Bound the entry at the next `name:` field, otherwise a later entry's
    // description bleeds into this one.
    NAME.lastIndex = m.index + m[0].length;
    const next = NAME.exec(text);
    NAME.lastIndex = m.index + m[0].length;
    const end = Math.min(next ? next.index : text.length, m.index + WINDOW);
    const entry = text.slice(m.index, end);

    if (!HANDLER.test(entry)) continue;
    const description = DESCRIPTION.exec(entry)?.[1];
    if (!description) continue;

    const hint = HINT.exec(entry)?.[1] ?? "";
    commands.set(name, {
      name,
      description,
      hint,
      args: hint !== "" || ALLOW_ARGS.test(entry),
    });
  }
}

const sorted = [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
if (sorted.length < 40) {
  console.error(`Only ${sorted.length} commands found — extraction pattern is stale.`);
  process.exit(1);
}

const rows = sorted
  .map(
    (c) =>
      `  { name: ${JSON.stringify(c.name)}, description: ${JSON.stringify(c.description)}` +
      (c.hint ? `, hint: ${JSON.stringify(c.hint)}` : "") +
      (c.args ? ", args: true" : "") +
      " },",
  )
  .join("\n");

writeFileSync(
  new URL("../src/shared/slash-commands.ts", import.meta.url),
  `/**
 * omp's slash commands — GENERATED, do not edit.
 *
 * Source: ${exe.replace(/\\/g, "/")}
 * Regenerate: node scripts/extract-slash-commands.mjs
 *
 * The composer palette filters this list, but never restricts input: an unknown
 * command is still typed through to omp verbatim.
 */

export type SlashCommand = {
  name: string;
  description: string;
  /** Argument placeholder shown in the palette, e.g. \`<path>\`. */
  hint?: string;
  /** Whether the command takes arguments. */
  args?: boolean;
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
${rows}
];
`,
  "utf8",
);
console.log(`Wrote ${sorted.length} commands.`);
