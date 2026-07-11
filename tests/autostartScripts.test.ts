import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Win11 Codex host scripts", () => {
  for (const file of [
    "scripts/refresh-codex-desktop.ps1",
    "scripts/send-codex-desktop-input.ps1"
  ]) {
    it(`${file} supports current and legacy desktop hosts`, () => {
      const source = fs.readFileSync(file, "utf8");

      expect(source).toContain("ChatGPT");
      expect(source).toContain("Codex");
      expect(source).toContain("OpenAI\\.Codex_");
    });
  }

  it("recognizes ChatGPT.exe only inside the Codex Windows package", () => {
    const source = fs.readFileSync("scripts/watch-codex-start-agent.ps1", "utf8");

    expect(source).toContain("ChatGPT");
    expect(source).toContain("OpenAI\\.Codex_");
    expect(source).toContain("Test-CodexRunning");
  });

  it("generates an app-server-enabled Win11 agent config", () => {
    const source = fs.readFileSync("scripts/setup-windows-agent.ps1", "utf8");

    expect(source).toContain("codexAppServer");
    expect(source).toContain('url = "ws://127.0.0.1:18765"');
    expect(source).toContain("enabled = $true");
  });
});
