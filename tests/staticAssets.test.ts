import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { TaskStore } from "../src/server/taskStore.js";
import type { DispatcherConfig } from "../src/shared/types.js";

const config: DispatcherConfig = {
  server: { host: "127.0.0.1", port: 4318, publicBaseUrl: "http://127.0.0.1:4318" },
  auth: { dispatcherToken: "panel-token", agentToken: "agent-token" },
  projects: [],
  projectDiscovery: {
    enabled: false,
    roots: ["D:/aixm"],
    exclude: [],
    defaultMode: "codex",
    allowedModes: ["codex"],
    notify: false
  },
  codex: { command: "codex", args: ["exec", "{{prompt}}"], promptStdin: false },
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

describe("static panel assets", () => {
  it("prevents stale mobile WebView caches for panel scripts", async () => {
    const response = await request(createApp(config, new TaskStore())).get("/app.js").expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("prevents stale mobile WebView caches for connection status logic", async () => {
    const response = await request(createApp(config, new TaskStore())).get("/connectionStatus.js").expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it.each(["/realtimeClient.js", "/realtimeState.js"])("prevents stale caches for %s", async (asset) => {
    const response = await request(createApp(config, new TaskStore())).get(asset).expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("prevents stale caches for lifecycle recovery logic", async () => {
    const response = await request(createApp(config, new TaskStore())).get("/lifecycleRecovery.js").expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("prevents stale caches for diagnostics logic", async () => {
    const response = await request(createApp(config, new TaskStore())).get("/diagnostics.js").expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
