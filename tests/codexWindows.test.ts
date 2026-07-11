import { describe, expect, it } from "vitest";
import {
  buildCodexDesktopExecutablePattern,
  buildWindowDiscoveryScript
} from "../src/agent/codexWindows.js";

describe("Codex desktop window discovery", () => {
  it("enumerates real top-level Codex windows by executable path", () => {
    const script = buildWindowDiscoveryScript();

    expect(script).toContain("EnumWindows");
    expect(script).toContain("GetWindowRect");
    expect(script).toContain("width < 320");
    expect(script).toContain("height < 240");
    expect(script).toContain("ChatGPT");
    expect(script).toContain("Codex");
    expect(script).toContain("handle = $window.Handle.ToString()");
    expect(script).not.toContain('$_.ProcessName -ieq "Codex" -or');
    expect(script).not.toContain("$_.MainWindowHandle");
  });

  it("matches the current ChatGPT.exe Codex desktop host", () => {
    const pattern = new RegExp(buildCodexDesktopExecutablePattern(), "i");

    expect(
      pattern.test(
        "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.707.3748.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe"
      )
    ).toBe(true);
  });

  it("keeps matching the legacy Codex.exe desktop host", () => {
    const pattern = new RegExp(buildCodexDesktopExecutablePattern(), "i");

    expect(
      pattern.test(
        "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.623.9142.0_x64__2p2nqsd0c76g0\\app\\Codex.exe"
      )
    ).toBe(true);
  });

  it("does not match the command-line app-server executable", () => {
    const pattern = new RegExp(buildCodexDesktopExecutablePattern(), "i");

    expect(
      pattern.test(
        "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.707.3748.0_x64__2p2nqsd0c76g0\\app\\resources\\codex.exe"
      )
    ).toBe(false);
  });
});
