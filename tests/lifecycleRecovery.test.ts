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

  it("recovers once from native resume and active app-state signals", async () => {
    const nativeApp = new FakeNativeApp();
    const calls: string[] = [];
    const controller = createLifecycleRecovery({
      documentTarget: new FakeDocument("hidden"),
      windowTarget: new EventTarget(),
      nativeApp,
      restartRealtime: () => calls.push("restart"),
      reconcile: async () => { calls.push("reconcile"); },
      now: () => 5000,
      minimumIntervalMs: 1000
    });
    controller.start();

    await nativeApp.emit("resume");
    await nativeApp.emit("appStateChange", { isActive: true });
    await controller.whenIdle();

    expect(calls).toEqual(["restart", "reconcile"]);
    await controller.stop();
  });

  it("ignores inactive native state and removes native listeners when stopped", async () => {
    const nativeApp = new FakeNativeApp();
    const restartRealtime = vi.fn();
    const reconcile = vi.fn(async () => undefined);
    const controller = createLifecycleRecovery({
      documentTarget: new FakeDocument("visible"),
      windowTarget: new EventTarget(),
      nativeApp,
      restartRealtime,
      reconcile
    });
    controller.start();

    await nativeApp.emit("appStateChange", { isActive: false });
    await controller.whenIdle();
    expect(restartRealtime).not.toHaveBeenCalled();

    await controller.stop();
    expect(nativeApp.listenerCount()).toBe(0);
    await nativeApp.emit("resume");
    expect(restartRealtime).not.toHaveBeenCalled();
  });

  it("still removes a registered native listener when its companion registration fails", async () => {
    const removeResumeListener = vi.fn(async () => undefined);
    const nativeApp = {
      addListener: (eventName: "resume" | "appStateChange") => eventName === "resume"
        ? Promise.resolve({ remove: removeResumeListener })
        : Promise.reject(new Error("app-state listener unavailable"))
    };
    const controller = createLifecycleRecovery({
      documentTarget: new FakeDocument("visible"),
      windowTarget: new EventTarget(),
      nativeApp,
      restartRealtime: vi.fn(),
      reconcile: vi.fn(async () => undefined)
    });
    controller.start();

    await controller.stop();

    expect(removeResumeListener).toHaveBeenCalledOnce();
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

class FakeNativeApp {
  private readonly listeners = new Map<string, Set<(payload?: { isActive?: boolean }) => unknown>>();

  async addListener(
    eventName: "resume" | "appStateChange",
    listener: (payload?: { isActive?: boolean }) => unknown
  ) {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);
    return {
      remove: async () => {
        listeners.delete(listener);
      }
    };
  }

  async emit(eventName: "resume" | "appStateChange", payload?: { isActive?: boolean }) {
    for (const listener of this.listeners.get(eventName) ?? []) {
      await listener(payload);
    }
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}
