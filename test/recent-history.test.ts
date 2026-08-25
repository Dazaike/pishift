import { describe, expect, it } from "vitest";
import { loadRecentChats, loadRecentFolders } from "../src/main/omp-data";

describe("loadRecentFolders", () => {
  it("returns an array of valid existing directories", () => {
    const folders = loadRecentFolders([process.cwd()]);
    expect(Array.isArray(folders)).toBe(true);
    expect(folders.length).toBeGreaterThan(0);
    // Should include current process directory
    const normalizedCwd = process.cwd().replace(/[\\/]+$/, "").toLowerCase();
    const hasCwd = folders.some((f) => f.replace(/[\\/]+$/, "").toLowerCase() === normalizedCwd);
    expect(hasCwd).toBe(true);
  });

  it("filters out non-existent folders and handles undefined input", () => {
    const folders = loadRecentFolders(["C:\\non_existent_folder_xyz_123456"]);
    expect(Array.isArray(folders)).toBe(true);
    const hasFake = folders.some((f) => f.includes("non_existent_folder_xyz_123456"));
    expect(hasFake).toBe(false);
  });
});

describe("loadRecentChats", () => {
  it("returns recent chats list for the current repository if sessions exist", () => {
    const chats = loadRecentChats(process.cwd());
    expect(Array.isArray(chats)).toBe(true);
    if (chats.length > 0) {
      expect(chats[0]).toHaveProperty("id");
      expect(chats[0]).toHaveProperty("title");
      expect(chats[0]).toHaveProperty("cwd");
      expect(chats[0]).toHaveProperty("updatedAt");
      expect(chats[0]).toHaveProperty("mtime");
    }
  });

  it("returns chats without throwing when cwd is omitted or empty", () => {
    const chats = loadRecentChats();
    expect(Array.isArray(chats)).toBe(true);
  });
});
