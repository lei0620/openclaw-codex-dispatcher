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

  it("settles active agent tasks when the agent disconnects", () => {
    const store = new TaskStore();
    const task = store.createTask({ projectId: "openclaw", prompt: "stuck task", mode: "codex", source: "panel" });
    store.assignNextTask("win11-main");
    store.requestCancel(task.id);

    const stopped = store.stopActiveTasksForAgent("win11-main");

    expect(stopped).toHaveLength(1);
    expect(store.getTask(task.id)?.status).toBe("cancelled");
    expect(store.getTask(task.id)?.finishedAt).toBeTruthy();
  });

  it("serializes tasks within the same conversation", () => {
    const store = new TaskStore();
    const conversation = store.createConversation({ projectId: "openclaw", title: "one" });
    const first = store.createTask({ projectId: "openclaw", conversationId: conversation.id, prompt: "first", mode: "codex", source: "panel" });
    const second = store.createTask({ projectId: "openclaw", conversationId: conversation.id, prompt: "second", mode: "codex", source: "panel" });

    expect(store.assignNextTask("win11-main")?.id).toBe(first.id);
    expect(store.assignNextTask("win11-main")).toBeUndefined();
    expect(store.getTask(second.id)?.status).toBe("queued");
  });

  it("assigns tasks from different unbound conversations in parallel", () => {
    const store = new TaskStore();
    const firstConversation = store.createConversation({ projectId: "openclaw", title: "one" });
    const secondConversation = store.createConversation({ projectId: "openclaw", title: "two" });
    const first = store.createTask({ projectId: "openclaw", conversationId: firstConversation.id, prompt: "first", mode: "codex", source: "panel" });
    const second = store.createTask({ projectId: "openclaw", conversationId: secondConversation.id, prompt: "second", mode: "codex", source: "panel" });

    expect(store.assignNextTask("win11-main")?.id).toBe(first.id);
    expect(store.assignNextTask("win11-main")?.id).toBe(second.id);
  });
});
