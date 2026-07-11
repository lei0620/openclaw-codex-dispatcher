import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskStore } from "../src/server/taskStore.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("TaskStore mobile reliability", () => {
  it("accepts twenty unique phone messages and deduplicates their retries", () => {
    const store = new TaskStore();
    for (let index = 0; index < 20; index += 1) {
      const input = {
        clientMessageId: `phone-message-${index}`,
        projectId: "openclaw",
        prompt: `message ${index}`,
        mode: "codex",
        source: "panel" as const
      };
      store.createTask(input);
      store.createTask(input);
    }

    expect(store.listTasks()).toHaveLength(20);
  });

  it("creates at most one task for a clientMessageId", () => {
    const store = new TaskStore();
    const conversation = store.createConversation({ projectId: "openclaw", title: "幂等测试" });
    const input = {
      projectId: "openclaw",
      conversationId: conversation.id,
      prompt: "只执行一次",
      mode: "codex",
      source: "panel" as const,
      clientMessageId: "phone-message-0001"
    };

    const first = store.createTask(input);
    const duplicate = store.createTask(input);

    expect(duplicate.id).toBe(first.id);
    expect(store.listTasks()).toHaveLength(1);
    expect(store.getTaskByClientMessageId("phone-message-0001")?.id).toBe(first.id);
  });

  it("persists ordered events and replays only events after the cursor", () => {
    const stateFile = createStateFile();
    const firstStore = new TaskStore(stateFile);
    const conversation = firstStore.createConversation({ projectId: "openclaw", title: "实时事件" });
    const cursor = firstStore.getLatestMobileEventId();
    const task = firstStore.createTask({
      projectId: "openclaw",
      conversationId: conversation.id,
      prompt: "实时收到",
      mode: "codex",
      source: "panel",
      clientMessageId: "phone-message-0002"
    });

    const reloaded = new TaskStore(stateFile);
    const window = reloaded.getMobileEventWindow(cursor);

    expect(window.resetRequired).toBe(false);
    expect(window.events).toHaveLength(1);
    expect(window.events[0]).toMatchObject({
      type: "task.created",
      conversationId: conversation.id,
      taskId: task.id,
      payload: { task: { clientMessageId: "phone-message-0002" } }
    });
    expect(window.events[0].eventId).toBeGreaterThan(cursor);
  });

  it("requires a full sync when the cursor is older than retained events", () => {
    const stateFile = createStateFile();
    const store = new TaskStore(stateFile, { mobileEventLimit: 3 });
    const conversation = store.createConversation({ projectId: "openclaw", title: "游标过期" });

    for (let index = 0; index < 5; index += 1) {
      store.createTask({
        projectId: "openclaw",
        conversationId: conversation.id,
        prompt: `消息 ${index}`,
        mode: "codex",
        source: "panel",
        clientMessageId: `phone-message-${index + 10}`
      });
    }

    const window = store.getMobileEventWindow(1);

    expect(window.resetRequired).toBe(true);
    expect(window.events).toEqual([]);
    expect(window.latestEventId).toBeGreaterThan(1);
  });

  it("publishes logs, task completion, and approval lifecycle events", () => {
    const store = new TaskStore();
    const conversation = store.createConversation({ projectId: "openclaw", title: "事件生命周期" });
    const task = store.createTask({
      projectId: "openclaw",
      conversationId: conversation.id,
      prompt: "执行",
      mode: "codex",
      source: "panel",
      clientMessageId: "phone-message-0030"
    });
    const cursor = store.getLatestMobileEventId();

    store.appendLog(task.id, "stdout", "实时片段");
    store.requestApproval({
      id: "approval-1",
      taskId: task.id,
      projectId: "openclaw",
      message: "允许执行测试命令吗？",
      status: "pending",
      createdAt: new Date().toISOString()
    });
    store.resolveApproval("approval-1", "approved");
    store.completeTask(task.id, { exitCode: 0, summary: "完成", diffSummary: "no changes" });

    const types = store.getMobileEventWindow(cursor).events.map((event) => event.type);
    expect(types).toEqual([
      "task.log",
      "task.updated",
      "approval.requested",
      "task.updated",
      "approval.resolved",
      "task.updated"
    ]);
  });

  it("publishes agent health only when the visible state changes", () => {
    const store = new TaskStore();
    const ready = {
      phase: "ready" as const,
      ready: true,
      checkedAt: "2026-07-11T01:30:00.000Z",
      endpoint: "ws://127.0.0.1:18765"
    };
    const cursor = store.getLatestMobileEventId();

    store.heartbeatAgent("LEI-PC", ready, "2026-07-11T01:30:00.000Z");
    store.heartbeatAgent("LEI-PC", { ...ready, checkedAt: "2026-07-11T01:30:10.000Z" }, "2026-07-11T01:30:10.000Z");
    store.heartbeatAgent(
      "LEI-PC",
      { ...ready, phase: "recovering", ready: false, checkedAt: "2026-07-11T01:30:20.000Z" },
      "2026-07-11T01:30:20.000Z"
    );

    const events = store.getMobileEventWindow(cursor).events;
    expect(events.map((event) => event.type)).toEqual(["agent.updated", "agent.updated"]);
    expect(events.at(-1)?.payload).toMatchObject({ agent: { codex: { phase: "recovering", ready: false } } });
  });
});

function createStateFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-mobile-events-"));
  tempDirs.push(dir);
  return path.join(dir, "state.json");
}
