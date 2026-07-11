import { describe, expect, it, vi } from "vitest";
import { createLifecycleRecovery } from "../public/lifecycleRecovery.js";

describe("createLifecycleRecovery", () => {
  it("ignores lifecycle events while the document is hidden", async () => {
    const documentTarget = new FakeDocument("hidden");
    const windowTarget = new EventTarget();
    const reconcile = vi.fn(async () => undefined);
    const controller = createLifecycleRecovery({ documentTarget, windowTarget, reconcile, restartRealtime: vi.fn() });
    controller.start();

    documentTarget.dispatchEvent(new Event("visibilitychange"));
    windowTarget.dispatchEvent(new Event("online"));
    await controller.whenIdle();

    expect(reconcile).not.toHaveBeenCalled();
    controller.stop();
  });

  it("restarts realtime and reconciles once when the app becomes visible", async () => {
    const documentTarget = new FakeDocument("hidden");
    const windowTarget = new EventTarget();
    const calls: string[] = [];
    const controller = createLifecycleRecovery({
      documentTarget,
      windowTarget,
      restartRealtime: () => calls.push("restart"),
      reconcile: async () => { calls.push("reconcile"); },
      now: () => 5000,
      minimumIntervalMs: 1000
    });
    controller.start();

    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    windowTarget.dispatchEvent(new Event("pageshow"));
    windowTarget.dispatchEvent(new Event("online"));
    await controller.whenIdle();

    expect(calls).toEqual(["restart", "reconcile"]);
    controller.stop();
  });

  it("does not know about or invoke task sending", async () => {
    const controller = createLifecycleRecovery({
      documentTarget: new FakeDocument("visible"),
      windowTarget: new EventTarget(),
      restartRealtime: vi.fn(),
      reconcile: vi.fn(async () => undefined)
    });

    expect("send" in controller).toBe(false);
    expect("retry" in controller).toBe(false);
  });
});

class FakeDocument extends EventTarget {
  constructor(public visibilityState: "hidden" | "visible") {
    super();
  }
}
