import request from "supertest";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
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
  it("ships seven transparent 192px generated header icons", () => {
    for (const name of ["menu", "window", "device", "sync", "approval", "exit", "settings"]) {
      const file = fs.readFileSync(`public/icons/${name}.png`);
      expect(file.subarray(1, 4).toString()).toBe("PNG");
      expect(file.readUInt32BE(16)).toBe(192);
      expect(file.readUInt32BE(20)).toBe(192);
      expect([4, 6]).toContain(file[25]);
    }
  });

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

  it("prevents stale caches for secure connection settings logic", async () => {
    const response = await request(createApp(config, new TaskStore())).get("/connectionSettings.js").expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("prevents stale caches for LAN and VPN failover logic", async () => {
    const response = await request(createApp(config, new TaskStore())).get("/apiBaseFailover.js").expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("prevents stale caches for realtime render scheduling", async () => {
    const response = await request(createApp(config, new TaskStore())).get("/realtimeRenderScheduler.js").expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
