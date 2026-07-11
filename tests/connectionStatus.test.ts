import { describe, expect, it } from "vitest";
import { deriveConnectionStatus } from "../public/connectionStatus.js";

describe("deriveConnectionStatus", () => {
  it("reports online only when NAS, agent, and Codex are ready", () => {
    expect(deriveConnectionStatus({ nasReachable: true, onlineAgents: 1, readyCodex: 1 })).toEqual({
      level: "online",
      label: "已连接",
      detail: "NAS、电脑和 Codex 均可用"
    });
  });

  it("reports recovery when NAS is reachable but Codex is not ready", () => {
    expect(deriveConnectionStatus({ nasReachable: true, onlineAgents: 1, readyCodex: 0 })).toMatchObject({
      level: "recovering",
      label: "恢复中"
    });
  });

  it("reports offline only when NAS cannot be reached", () => {
    expect(deriveConnectionStatus({ nasReachable: false, onlineAgents: 0, readyCodex: 0 })).toMatchObject({
      level: "offline",
      label: "未连接"
    });
  });
});
