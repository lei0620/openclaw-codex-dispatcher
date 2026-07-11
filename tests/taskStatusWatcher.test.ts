import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

describe("createTaskStatusWatcher", () => {
  it("keeps polling one submitted task until its terminal result is observed", async () => {
    vi.useFakeTimers();
    const { createTaskStatusWatcher } = await import("../public/taskStatusWatcher.js");
    const updates = [
      { id: "task-1", status: "running" },
      { id: "task-1", status: "completed", result: { summary: "实时收到" } }
    ];
    const loadTask = vi.fn(async () => updates.shift());
    const observed: Array<{ id: string; status: string; result?: { summary: string } }> = [];
    const watcher = createTaskStatusWatcher({
      loadTask,
      onTask: (task) => observed.push(task),
      intervalMs: 1000
    });

    watcher.watch("task-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toEqual([{ id: "task-1", status: "running" }]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(observed.at(-1)).toMatchObject({ status: "completed", result: { summary: "实时收到" } });
    expect(loadTask).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5000);
    expect(loadTask).toHaveBeenCalledTimes(2);
  });

  it("retries temporary request failures without losing the task watcher", async () => {
    vi.useFakeTimers();
    const { createTaskStatusWatcher } = await import("../public/taskStatusWatcher.js");
    const loadTask = vi.fn()
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValueOnce({ id: "task-2", status: "failed", error: "执行失败" });
    const observed: Array<{ id: string; status: string }> = [];
    const watcher = createTaskStatusWatcher({ loadTask, onTask: (task) => observed.push(task), intervalMs: 1000 });

    watcher.watch("task-2");
    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(observed).toEqual([{ id: "task-2", status: "failed", error: "执行失败" }]);
  });

  it("does not start duplicate polling loops for the same task", async () => {
    vi.useFakeTimers();
    const { createTaskStatusWatcher } = await import("../public/taskStatusWatcher.js");
    const loadTask = vi.fn(async () => ({ id: "task-3", status: "running" }));
    const watcher = createTaskStatusWatcher({ loadTask, onTask: () => undefined, intervalMs: 1000 });

    watcher.watch("task-3");
    watcher.watch("task-3");
    await vi.advanceTimersByTimeAsync(0);

    expect(loadTask).toHaveBeenCalledTimes(1);
    watcher.stopAll();
  });
});
