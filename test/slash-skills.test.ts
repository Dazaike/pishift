import { describe, expect, it } from "vitest";

import { loadSkillCommands } from "../src/main/omp-skills";
import type { SlashCommand } from "../src/shared/slash-commands";
import { rankSlashCommand, rankSlashCommands } from "../src/shared/slash-rank";

describe("rankSlashCommand", () => {
  const skill: SlashCommand = { name: "skill:pdf", description: "" };

  it("treats an exact bare-segment match as exact", () => {
    expect(rankSlashCommand(skill, "pdf")).toBe(0);
  });

  it("prefix-matches a namespaced command by its bare segment", () => {
    expect(rankSlashCommand(skill, "pd")).toBe(1);
  });

  it("scores an exact full-name match best", () => {
    expect(rankSlashCommand(skill, "skill:pdf")).toBe(0);
  });

  it("rejects a non-match", () => {
    expect(rankSlashCommand(skill, "zzz")).toBe(4);
  });

  it("falls back to description matching", () => {
    expect(rankSlashCommand({ name: "clear", description: "Wipe the context" }, "wipe")).toBe(3);
  });

  it("prefers prefix over substring on the bare segment", () => {
    expect(rankSlashCommand(skill, "df")).toBe(2);
  });
});

describe("rankSlashCommands", () => {
  const fixture: SlashCommand[] = [
    { name: "alpha", description: "a" },
    { name: "beta", description: "b" },
    { name: "gamma", description: "c" },
  ];

  it("orders an empty query by usage desc then name asc", () => {
    const ordered = rankSlashCommands(fixture, "", { gamma: 5 });
    expect(ordered.map((c) => c.name)).toEqual(["gamma", "alpha", "beta"]);
  });

  it("puts better match quality ahead of usage", () => {
    const ordered = rankSlashCommands(fixture, "beta", { alpha: 99 });
    expect(ordered[0]!.name).toBe("beta");
  });
});

describe("loadSkillCommands", () => {
  it("returns well-formed, unique skill commands", () => {
    const items = loadSkillCommands(process.cwd());
    expect(Array.isArray(items)).toBe(true);
    for (const item of items) {
      expect(item.name).toMatch(/^skill:[^\s/]+$/);
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.description.length).toBeLessThanOrEqual(161);
      expect(item.args).toBe(true);
    }
    expect(new Set(items.map((c) => c.name)).size).toBe(items.length);
    expect(items.some((c) => c.name === "skill:pdf")).toBe(true);
  });

  it("survives a non-existent cwd and still finds user-level skills", () => {
    const items = loadSkillCommands("C:\\non_existent_folder_xyz_123456");
    expect(items.length).toBeGreaterThan(0);
  });
});
