import { describe, expect, it } from "vitest";
import { buildDiagnosticsSnapshot, formatSanitizedDiagnostics } from "../public/diagnostics.js";

describe("mobile diagnostics", () => {
  it("builds a compact snapshot from the current connection and conversation", () => {
    const snapshot = buildDiagnosticsSnapshot({
      generatedAt: "2026-07-11T05:00:00.000Z",
      appVersion: "1.7.0",
      apiBase: "http://192.168.101.8:1314",
      realtimeState: "online",
      lastEventId: 42,
      health: { services: { nas: { reachable: true }, codex: { ready: 1 } } },
      latencyMs: 18,
      agents: [{ id: "LEI-PC", online: true, lastSeenAt: "2026-07-11T04:59:59.000Z", codex: { phase: "ready", ready: true } }],
      codexWindows: [{ id: "window-1" }],
      conversation: { id: "conversation-1", projectId: "openclaw", codexSessionId: "thread-1" },
      pendingApprovals: 1,
      activeTasks: 2,
      latestError: ""
    });

    expect(snapshot).toMatchObject({
      appVersion: "1.7.0",
      nas: { reachable: true, latencyMs: 18, realtimeState: "online", lastEventId: 42 },
      agent: { id: "LEI-PC", online: true, codexPhase: "ready" },
      codex: { ready: true, windowCount: 1 },
      conversation: { id: "conversation-1", threadId: "thread-1" },
      pendingApprovals: 1,
      activeTasks: 2
    });
  });

  it("redacts credentials and secret-like values from exported diagnostics", () => {
    const report = formatSanitizedDiagnostics({
      apiBase: "http://192.168.101.8:1314",
      token: "plain-token-value",
      nested: { password: "plain-password", secret: "plain-secret" },
      latestError: "Authorization: Bearer secret-token password=hello webdav=kmtfs84y token=397b6987fc3424c5b44326f372ad79c1536edd5eec6c62bc53b9358cb9a76b01"
    });

    expect(report).toContain("http://192.168.101.8:1314");
    expect(report).not.toContain("secret-token");
    expect(report).not.toContain("plain-token-value");
    expect(report).not.toContain("plain-password");
    expect(report).not.toContain("plain-secret");
    expect(report).not.toContain("hello");
    expect(report).not.toContain("kmtfs84y");
    expect(report).not.toContain("397b6987");
    expect(report).toContain("[已隐藏]");
  });
});
