import { describe, expect, it } from "vitest";
import { TaskStore } from "../src/server/taskStore.js";

describe("TaskStore", () => {
  it("queues, assigns, logs, and completes a task", () => {
    const store = new TaskStore();
    const task = store.createTask({
      projectId: "openclaw",
      prompt: "summarize the project",
      mode: "codex",
      source: "panel"
    });

    expect(task.status).toBe("queued");
    const assigned = store.assignNextTask("win11-main");
    expect(assigned?.id).toBe(task.id);
    expect(store.getTask(task.id)?.status).toBe("running");

    store.appendLog(task.id, "stdout", "hello");
    store.completeTask(task.id, { exitCode: 0, summary: "done", diffSummary: "no changes" });

    const completed = store.getTask(task.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.logs[0]).toMatchObject({ stream: "stdout", text: "hello" });
    expect(completed?.result?.summary).toBe("done");
  });

  it("marks running tasks as cancellation requested", () => {
    const store = new TaskStore();
    const task = store.createTask({ projectId: "openclaw", prompt: "stop me", mode: "codex", source: "panel" });
    store.assignNextTask("win11-main");

    const cancelled = store.requestCancel(task.id);

    expect(cancelled.status).toBe("cancelling");
    expect(cancelled.cancelRequestedAt).toBeTruthy();
  });
});
