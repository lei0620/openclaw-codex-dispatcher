import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseViewEvents, readCodexDesktopReadStates } from "../src/agent/codexDesktopReadState.js";

describe("Codex desktop read state", () => {
  const originalLogRoot = process.env.OPENCLAW_CODEX_DESKTOP_LOG_ROOT;

  afterEach(() => {
    if (originalLogRoot === undefined) delete process.env.OPENCLAW_CODEX_DESKTOP_LOG_ROOT;
    else process.env.OPENCLAW_CODEX_DESKTOP_LOG_ROOT = originalLogRoot;
  });

  it("parses desktop thread view activity", () => {
    const events = parseViewEvents([
      logLine("2026-07-16T15:00:00.000Z", true, "thread-a", "1"),
      logLine("2026-07-16T15:01:00.000Z", false, "thread-a", "1")
    ].join("\n"));

    expect(events).toEqual([
      { at: "2026-07-16T15:00:00.000Z", active: true, sessionId: "thread-a", windowId: "1" },
      { at: "2026-07-16T15:01:00.000Z", active: false, sessionId: "thread-a", windowId: "1" }
    ]);
  });

  it("keeps read time and the currently active desktop conversation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-desktop-logs-"));
    try {
      process.env.OPENCLAW_CODEX_DESKTOP_LOG_ROOT = root;
      fs.writeFileSync(path.join(root, "desktop.log"), [
        logLine("2026-07-16T15:00:00.000Z", true, "thread-a", "1"),
        logLine("2026-07-16T15:01:00.000Z", false, "thread-a", "1"),
        logLine("2026-07-16T15:02:00.000Z", true, "thread-b", "1")
      ].join("\n"));

      expect(Object.fromEntries(readCodexDesktopReadStates())).toEqual({
        "thread-a": { active: false, readAt: "2026-07-16T15:01:00.000Z" },
        "thread-b": { active: true, readAt: "2026-07-16T15:02:00.000Z" }
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function logLine(at: string, active: boolean, conversationId: string, windowId: string): string {
  return `${at} info [electron-message-handler] thread_stream_view_activity_changed active=${active} conversationId=${conversationId} rendererWindowFocused=true rendererWindowId=${windowId} rendererWindowVisible=true`;
}
