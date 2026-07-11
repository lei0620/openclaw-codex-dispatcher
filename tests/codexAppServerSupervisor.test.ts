import { describe, expect, it, vi } from "vitest";
import { CodexAppServerSupervisor } from "../src/agent/codexAppServerSupervisor.js";

const config = {
  enabled: true,
  url: "ws://127.0.0.1:18765",
  startupTimeoutMs: 1000,
  requestTimeoutMs: 1000,
  turnTimeoutMs: 1000,
  supervisorIntervalMs: 5000,
  heartbeatIntervalMs: 10000
};

describe("CodexAppServerSupervisor", () => {
  it("prewarms the app-server and reports ready", async () => {
    const ensureReady = vi.fn().mockResolvedValue(undefined);
    const probeReady = vi.fn().mockResolvedValue(true);
    const supervisor = new CodexAppServerSupervisor(config, { ensureReady, probeReady });

    await supervisor.ensureReady();

    expect(ensureReady).toHaveBeenCalledOnce();
    expect(supervisor.getStatus()).toMatchObject({ phase: "ready", ready: true });
  });

  it("reports recovering after a failed health check without throwing from the loop", async () => {
    const ensureReady = vi.fn().mockRejectedValue(new Error("startup failed"));
    const probeReady = vi.fn().mockResolvedValue(false);
    const supervisor = new CodexAppServerSupervisor(config, { ensureReady, probeReady });

    await expect(supervisor.check()).resolves.toBeUndefined();

    expect(supervisor.getStatus()).toMatchObject({
      phase: "recovering",
      ready: false,
      error: "startup failed"
    });
  });
});
