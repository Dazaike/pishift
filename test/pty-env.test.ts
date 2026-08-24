import { describe, expect, it } from "vitest";

import { buildPtyEnv } from "../src/main/pty-env";

describe("buildPtyEnv", () => {
  it("strips inherited terminal identity and selects the iterm2 profile", () => {
    const env = buildPtyEnv(
      {
        KITTY_WINDOW_ID: "1",
        GHOSTTY_RESOURCES_DIR: "C:/ghostty",
        WEZTERM_PANE: "0",
        ALACRITTY_WINDOW_ID: "7",
        VSCODE_PID: "4242",
        TERM_PROGRAM: "vscode",
        TERM_PROGRAM_VERSION: "1.99",
        WT_SESSION: "abc",
        WT_PROFILE_ID: "{guid}",
        PATH: "C:/Windows",
        TERM: "xterm",
        COLORTERM: "",
      },
      "session-1",
    );

    for (const stripped of [
      "KITTY_WINDOW_ID",
      "GHOSTTY_RESOURCES_DIR",
      "WEZTERM_PANE",
      "ALACRITTY_WINDOW_ID",
      "VSCODE_PID",
      "TERM_PROGRAM",
      "TERM_PROGRAM_VERSION",
      "WT_SESSION",
      "WT_PROFILE_ID",
    ]) {
      expect(env).not.toHaveProperty(stripped);
    }

    expect(env.TERM).toBe("xterm-256color");
    expect(env.COLORTERM).toBe("truecolor");
    expect(env.ITERM_SESSION_ID).toBe("w0t0p0:session-1");
    expect(env.PATH).toBe("C:/Windows");
  });

  it("drops undefined values and never returns the caller's object", () => {
    const base = { A: "1", B: undefined };
    const env = buildPtyEnv(base, "id");
    expect(env).not.toHaveProperty("B");
    expect(env.A).toBe("1");
    expect(base).not.toHaveProperty("ITERM_SESSION_ID");
  });
});
