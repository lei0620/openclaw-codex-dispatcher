import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(path.resolve("public/unreadTasks.js")).href;

describe("createUnreadTaskStore", () => {
  it("treats terminal tasks present at the first baseline as already read", async () => {
    const { createUnreadTaskStore } = await import(moduleUrl);
    const storage = new MemoryStorage();
    const store = createUnreadTaskStore(storage, { now: () => "2026-07-12T10:00:00.000Z" });
    const tasks = [terminalTask("old", "conversation-a", "2026-07-12T09:59:00.000Z")];

    store.reconcile(tasks, { activeConversationId: "conversation-b", activeConversationVisible: true });

    expect(store.getUnreadTasks(tasks)).toEqual([]);
  });

  it("keeps a later completion from another conversation unread across restart", async () => {
    const { createUnreadTaskStore } = await import(moduleUrl);
    const storage = new MemoryStorage();
    const tasks = [terminalTask("new", "conversation-a", "2026-07-12T10:01:00.000Z")];
    createUnreadTaskStore(storage, { now: () => "2026-07-12T10:00:00.000Z" });

    const restarted = createUnreadTaskStore(storage, { now: () => "2026-07-12T10:02:00.000Z" });
    restarted.reconcile(tasks, { activeConversationId: "conversation-b", activeConversationVisible: true });

    expect(restarted.getUnreadTasks(tasks).map((task: { id: string }) => task.id)).toEqual(["new"]);
  });

  it("marks a completion in the visible active conversation as read", async () => {
    const { createUnreadTaskStore } = await import(moduleUrl);
    const storage = new MemoryStorage();
    const store = createUnreadTaskStore(storage, { now: () => "2026-07-12T10:00:00.000Z" });
    const tasks = [terminalTask("visible", "conversation-a", "2026-07-12T10:01:00.000Z")];

    store.reconcile(tasks, { activeConversationId: "conversation-a", activeConversationVisible: true });

    expect(store.getUnreadTasks(tasks)).toEqual([]);
  });

  it("clears every terminal task in a conversation when the card is opened", async () => {
    const { createUnreadTaskStore } = await import(moduleUrl);
    const storage = new MemoryStorage();
    const store = createUnreadTaskStore(storage, { now: () => "2026-07-12T10:00:00.000Z" });
    const tasks = [
      terminalTask("first", "conversation-a", "2026-07-12T10:01:00.000Z"),
      terminalTask("second", "conversation-a", "2026-07-12T10:02:00.000Z", "failed"),
      terminalTask("other", "conversation-b", "2026-07-12T10:03:00.000Z")
    ];

    store.markConversationRead("conversation-a", tasks);

    expect(store.getUnreadTasks(tasks).map((task: { id: string }) => task.id)).toEqual(["other"]);
  });
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function terminalTask(id: string, conversationId: string, finishedAt: string, status = "completed") {
  return { id, conversationId, projectId: `project-${conversationId}`, status, finishedAt, updatedAt: finishedAt };
}
