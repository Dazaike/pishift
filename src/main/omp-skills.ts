/**
 * Discovers omp's on-disk skills so the composer palette can offer the
 * `/skill:<name>` commands omp registers at runtime (one per skill).
 *
 * The generated `SLASH_COMMANDS` list can never contain these — they are user,
 * project, and plugin files — so they are scanned here in main and shipped to
 * the renderer over IPC.
 */

import {
  closeSync,
  type Dirent,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { SlashCommand } from "../shared/slash-commands";

const HOME = homedir();
const OMP_AGENT_DIR = join(HOME, ".omp", "agent");
const PLUGINS_DIR = join(HOME, ".omp", "plugins", "node_modules");

/** Max bytes read per SKILL.md — frontmatter is always at the top. */
const HEAD_BYTES = 8192;
const DESC_LIMIT = 160;
const CACHE_TTL_MS = 15_000;

const cache = new Map<string, { at: number; items: SlashCommand[] }>();

function normalizeDirPath(dir: string): string {
  try {
    return resolve(dir).replace(/[\\/]+$/, "");
  } catch {
    return dir;
  }
}

/** `<pkg>/skills` for every plugin package, including one level of `@scope/`. */
function pluginSkillRoots(): string[] {
  const roots: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });
  } catch {
    return roots;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      try {
        for (const scoped of readdirSync(join(PLUGINS_DIR, entry.name), { withFileTypes: true })) {
          if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue;
          roots.push(join(PLUGINS_DIR, entry.name, scoped.name, "skills"));
        }
      } catch {
        // Unreadable scope dir — skip.
      }
      continue;
    }
    roots.push(join(PLUGINS_DIR, entry.name, "skills"));
  }
  return roots;
}

/** Skill roots in omp's provider precedence order; first name wins. */
function skillRoots(cwd: string): string[] {
  const roots: string[] = [];
  if (cwd) roots.push(join(cwd, ".omp", "skills"));
  roots.push(join(OMP_AGENT_DIR, "skills"));
  roots.push(...pluginSkillRoots());
  roots.push(join(HOME, ".claude", "skills"));
  if (cwd) roots.push(join(cwd, ".claude", "skills"));
  if (cwd) roots.push(join(cwd, ".agent", "skills"), join(cwd, ".agents", "skills"));
  roots.push(join(HOME, ".agent", "skills"), join(HOME, ".agents", "skills"));
  roots.push(join(HOME, ".codex", "skills"));
  if (cwd) roots.push(join(cwd, ".codex", "skills"));
  roots.push(join(HOME, ".config", "opencode", "skills"));
  if (cwd) roots.push(join(cwd, ".opencode", "skills"));
  if (cwd) roots.push(join(cwd, ".github", "skills"));
  roots.push(join(OMP_AGENT_DIR, "managed-skills"));
  return roots;
}

function readHead(filePath: string): string | null {
  let fd: number | null = null;
  try {
    const size = statSync(filePath).size;
    if (size === 0) return "";
    fd = openSync(filePath, "r");
    const len = Math.min(size, HEAD_BYTES);
    const buf = Buffer.alloc(len);
    const bytesRead = readSync(fd, buf, 0, len, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Already closed / invalid fd.
      }
    }
  }
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
}

/**
 * Minimal `name`/`description` frontmatter extraction — no YAML dependency.
 * Handles plain scalars, single/double quoting, and block scalars (`>`, `|`,
 * with chomping indicators), which several shipped skills use for `description`.
 */
function parseFrontmatter(text: string): SkillFrontmatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  const out: SkillFrontmatter = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "---") return out;
    const m = /^(name|description):\s*(.*)$/.exec(line);
    if (!m) continue;
    const v = m[2]!.trim();
    let value: string;
    if (/^[>|][-+]?\d*$/.test(v)) {
      // Block scalar: body is the following blank or more-indented lines.
      const parts: string[] = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!;
        if (next.trim() === "---") break;
        if (next.trim() !== "" && !/^\s/.test(next)) break;
        parts.push(next.trim());
        i++;
      }
      value = parts.join(" ");
    } else if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
      value = v.slice(1, -1);
    } else {
      value = v;
    }
    if (m[1] === "name") out.name = value;
    else out.description = value;
  }
  return {}; // No closing marker — not frontmatter.
}

function scanRoot(root: string, seen: Set<string>, out: SlashCommand[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return; // Missing root or permission error.
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".")) continue;
    const skillFile = join(root, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const head = readHead(skillFile);
    if (head === null) continue;
    const fm = parseFrontmatter(head);
    // omp keys commands by skill name; a name with whitespace or `/` would be
    // untypable, so the directory name wins in that case.
    const name = fm.name && !/[\s/]/.test(fm.name) ? fm.name : entry.name;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Palette rows are single-line; some skills ship ~380-char descriptions.
    const desc = (fm.description ?? "").replace(/\s+/g, " ").trim();
    out.push({
      name: `skill:${name}`,
      description: !desc
        ? `Skill: ${name}`
        : desc.length > DESC_LIMIT
          ? `${desc.slice(0, DESC_LIMIT)}\u2026`
          : desc,
      args: true,
    });
  }
}

/**
 * `/skill:<name>` palette rows for every skill visible from `cwd`.
 * Results are cached per cwd for 15s so tab switches don't rescan disk, while
 * newly authored skills still appear without restarting the app.
 */
export function loadSkillCommands(cwd?: string): SlashCommand[] {
  const norm = cwd ? normalizeDirPath(cwd) : "";
  const key = norm.toLowerCase();
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.items;

  const seen = new Set<string>();
  const items: SlashCommand[] = [];
  for (const root of skillRoots(norm)) scanRoot(root, seen, items);
  items.sort((a, b) => a.name.localeCompare(b.name));

  cache.set(key, { at: now, items });
  return items;
}
