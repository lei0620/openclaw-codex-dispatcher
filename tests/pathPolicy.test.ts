import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProject } from "../src/shared/pathPolicy.js";
import type { DispatcherConfig } from "../src/shared/types.js";

const config: DispatcherConfig = {
  server: { host: "127.0.0.1", port: 4318, publicBaseUrl: "http://127.0.0.1:4318" },
  auth: { dispatcherToken: "panel-token", agentToken: "agent-token" },
  projects: [
    {
      id: "openclaw",
      name: "OpenClaw Bridge",
      path: path.resolve("D:/aixm/openclaw"),
      defaultMode: "codex",
      allowedModes: ["codex", "dry-run"],
      notify: true
    }
  ],
  projectDiscovery: {
    enabled: false,
    roots: ["D:/aixm"],
    exclude: ["beifen"],
    defaultMode: "codex",
    allowedModes: ["codex", "dry-run"],
    notify: true
  },
  codex: {
    command: "codex",
    args: ["exec", "{{prompt}}"],
    promptStdin: false
  },
  codexAppServer: {
    enabled: false,
    url: "ws://127.0.0.1:8765",
    startupTimeoutMs: 60000,
    requestTimeoutMs: 30000,
    turnTimeoutMs: 120000
  },
  desktopInput: {
    enabled: false,
    scriptPath: "scripts/send-codex-desktop-input.ps1",
    clickYOffset: 92,
    windowTitlePattern: "Codex|OpenAI",
    responseTimeoutMs: 180000
  }
};

describe("resolveProject", () => {
  it("returns a whitelisted project by id", () => {
    expect(resolveProject(config, "openclaw").path).toMatch(/openclaw$/i);
  });

  it("rejects an unknown project id", () => {
    expect(() => resolveProject(config, "outside")).toThrow(/project is not whitelisted/i);
  });

  it("rejects a mode that is not allowed for the project", () => {
    expect(() => resolveProject(config, "openclaw", "danger")).toThrow(/mode is not allowed/i);
  });
});
