import { describe, expect, it, vi } from "vitest";
import { createRealtimeRenderScheduler } from "../public/realtimeRenderScheduler.js";

describe("realtime render scheduler", () => {
  it("coalesces a burst of streamed logs into one render", async () => {
    vi.useFakeTimers();
    try {
      const render = vi.fn();
      const scheduler = createRealtimeRenderScheduler(render, { delayMs: 80 });

      scheduler.schedule();
      scheduler.schedule();
      scheduler.schedule();

      expect(render).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(79);
      expect(render).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(render).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending log render when an immediate state update takes over", async () => {
    vi.useFakeTimers();
    try {
      const render = vi.fn();
      const scheduler = createRealtimeRenderScheduler(render, { delayMs: 80 });

      scheduler.schedule();
      scheduler.cancel();
      await vi.runAllTimersAsync();

      expect(render).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
