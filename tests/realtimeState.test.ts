import { describe, expect, it } from "vitest";
import { applyMobileEvent } from "../public/realtimeState.js";
import type { MobileEvent, TaskRecord } from "../src/shared/types.js";

describe("applyMobileEvent", () => {
  it("replaces an optimistic phone task by clientMessageId without creating a duplicate bubble", () => {
    const state = createState();
    state.tasks = [{
      id: "local:message-1",
      clientMessageId: "message-1",
      conversationId: "conversation-1",
      prompt: "在吗",
      status: "sending",
      logs: []
    }];

    applyMobileEvent(state, taskEvent(1, {
      id: "task-1",
      clientMessageId: "message-1",
      conversationId: "conversation-1",
      prompt: "在吗",
      status: "queued",
      logs: []
    }));

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ id: "task-1", status: "queued" });
  });

  it("keeps tasks scoped to the active conversation while tracking other active sessions", () => {
    const state = createState();

    applyMobileEvent(state, taskEvent(2, {
      id: "task-other",
      conversationId: "conversation-2",
      prompt: "并行任务",
      status: "running",
      logs: []
    }));

    expect(state.tasks).toEqual([]);
    expect(state.activeTasks).toMatchObject([{ id: "task-other", conversationId: "conversation-2" }]);
  });

  it("appends a streamed log once even when reconciliation repeats it", () => {
    const state = createState();
    state.tasks = [{ id: "task-1", conversationId: "conversation-1", status: "running", logs: [] }];
    const event: MobileEvent = {
      eventId: 3,
      type: "task.log",
      taskId: "task-1",
      conversationId: "conversation-1",
      occurredAt: "2026-07-11T01:00:00.000Z",
      payload: { log: { at: "2026-07-11T01:00:00.000Z", stream: "stdout", text: "实时收到" } }
    };

    applyMobileEvent(state, event);
    applyMobileEvent(state, event);

    expect(state.tasks[0].logs).toHaveLength(1);
    expect(state.tasks[0].logs[0].text).toBe("实时收到");
  });

  it("adds and resolves approval cards in realtime", () => {
    const state = createState();
    const approval = { id: "approval-1", taskId: "task-1", status: "pending" };

    applyMobileEvent(state, {
      eventId: 4,
      type: "approval.requested",
      occurredAt: "2026-07-11T01:00:00.000Z",
      payload: { approval }
    });
    expect(state.approvals).toMatchObject([{ id: "approval-1", status: "pending" }]);

    applyMobileEvent(state, {
      eventId: 5,
      type: "approval.resolved",
      occurredAt: "2026-07-11T01:00:01.000Z",
      payload: { approval: { ...approval, status: "approved" } }
    });
    expect(state.approvals).toEqual([]);
  });

  it("removes a deleted conversation and clears the active selection", () => {
    const state = createState();
    state.conversations = [
      { id: "conversation-1", projectId: "openclaw", title: "旧对话" },
      { id: "conversation-2", projectId: "openclaw", title: "保留对话" }
    ];

    applyMobileEvent(state, {
      eventId: 6,
      type: "conversation.deleted",
      conversationId: "conversation-1",
      occurredAt: "2026-07-11T01:00:02.000Z",
      payload: { conversationId: "conversation-1" }
    });

    expect(state.conversations).toEqual([
      { id: "conversation-2", projectId: "openclaw", title: "保留对话" }
    ]);
    expect(state.activeConversationId).toBe("");
  });
});

function createState(): any {
  return {
    activeConversationId: "conversation-1",
    projects: [],
    conversations: [],
    tasks: [],
    activeTasks: [],
    approvals: [],
    agents: [],
    codexWindows: []
  };
}

function taskEvent(eventId: number, task: Partial<TaskRecord> & Pick<TaskRecord, "id" | "conversationId">): MobileEvent {
  return {
    eventId,
    type: "task.created",
    taskId: task.id,
    conversationId: task.conversationId,
    occurredAt: "2026-07-11T01:00:00.000Z",
    payload: { task }
  };
}
