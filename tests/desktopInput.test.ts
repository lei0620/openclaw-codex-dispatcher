import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDesktopInputScriptArgs,
  findReplyAfterPrompt,
  parseDesktopWindowTarget
} from "../src/agent/desktopInput.js";
import type { DesktopInputConfig } from "../src/shared/types.js";

const config: DesktopInputConfig = {
  enabled: true,
  scriptPath: "scripts/send-codex-desktop-input.ps1",
  clickYOffset: 92,
  windowTitlePattern: "Codex|OpenAI",
  responseTimeoutMs: 180000
};

describe("desktop input targeting", () => {
  it("passes a bound process id to the desktop input script", () => {
    const target = parseDesktopWindowTarget("LEI-PC:pid:24228");
    const args = buildDesktopInputScriptArgs(
      "scripts/send-codex-desktop-input.ps1",
      "C:/Temp/prompt.txt",
      config,
      "LEI-PC:pid:24228"
    );

    expect(target).toEqual({ processId: "24228" });
    expect(args).toContain("-WindowProcessId");
    expect(args).toContain("24228");
    expect(args).not.toContain("-WindowHandle");
  });

  it("passes a bound window handle to the desktop input script", () => {
    const target = parseDesktopWindowTarget("LEI-PC:hwnd:123456");
    const args = buildDesktopInputScriptArgs(
      "scripts/send-codex-desktop-input.ps1",
      "C:/Temp/prompt.txt",
      config,
      "LEI-PC:hwnd:123456"
    );

    expect(target).toEqual({ handle: "123456" });
    expect(args).toContain("-WindowHandle");
    expect(args).toContain("123456");
    expect(args).not.toContain("-WindowProcessId");
  });

  it("opens the exact Codex desktop session before typing into the bound window", () => {
    const sessionId = "019ea021-ef66-7fd2-8e09-f2c6d26d0c4d";
    const args = buildDesktopInputScriptArgs(
      "scripts/send-codex-desktop-input.ps1",
      "C:/Temp/prompt.txt",
      config,
      "LEI-PC:hwnd:123456",
      sessionId
    );
    const script = fs.readFileSync("scripts/send-codex-desktop-input.ps1", "utf8");

    expect(args).toEqual(expect.arrayContaining(["-CodexSessionId", sessionId]));
    expect(script).toContain('"codex://threads/$CodexSessionId"');
    expect(script).toContain("Start-Process -FilePath $threadUri");
  });
});

describe("desktop reply capture", () => {
  it("only captures replies from the expected Codex session", () => {
    const previousCodexHome = process.env.CODEX_HOME;
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    try {
      const sessions = path.join(codexHome, "sessions", "2026", "06", "21");
      fs.mkdirSync(sessions, { recursive: true });
      const sinceMs = Date.now() - 2000;
      writeSession(path.join(sessions, "rollout-expected.jsonl"), "expected-session", "在吗", "正确窗口回复");
      writeSession(path.join(sessions, "rollout-other.jsonl"), "other-session", "在吗", "错误窗口回复");

      const reply = findReplyAfterPrompt("在吗", sinceMs, "expected-session");

      expect(reply).toEqual({ sessionId: "expected-session", text: "正确窗口回复" });
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      fs.rmSync(codexHome, { recursive: true, force: true });
    }
  });

  it("does not borrow a reply from another session when the expected session has no answer", () => {
    const previousCodexHome = process.env.CODEX_HOME;
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    try {
      const sessions = path.join(codexHome, "sessions", "2026", "06", "21");
      fs.mkdirSync(sessions, { recursive: true });
      const sinceMs = Date.now() - 2000;
      writeSession(path.join(sessions, "rollout-expected.jsonl"), "expected-session", "在吗", "");
      writeSession(path.join(sessions, "rollout-other.jsonl"), "other-session", "在吗", "错误窗口回复");

      const reply = findReplyAfterPrompt("在吗", sinceMs, "expected-session");

      expect(reply).toBeUndefined();
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      fs.rmSync(codexHome, { recursive: true, force: true });
    }
  });
});

function writeSession(filePath: string, sessionId: string, prompt: string, reply: string): void {
  const now = new Date().toISOString();
  const lines: Array<Record<string, unknown>> = [
    { type: "session_meta", timestamp: now, payload: { id: sessionId } },
    {
      type: "response_item",
      timestamp: now,
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] }
    }
  ];
  if (reply) {
    lines.push({
      type: "response_item",
      timestamp: now,
      payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: reply }] }
    });
  }
  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
}
