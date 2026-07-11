import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

describe("mobile conversation request isolation", () => {
  it("discards a slower task response after the user switches conversations", async () => {
    const loadActiveTasks = loadFunction("loadActiveTasks", {
      state: {
        activeConversationId: "conversation-a",
        tasks: [{ id: "visible-b" }],
        conversations: []
      },
      api: async () => {
        await Promise.resolve();
        return { tasks: [{ id: "stale-a" }], conversation: { id: "conversation-a" } };
      },
      mergePendingTasks: (tasks: unknown[]) => tasks
    });

    const promise = loadActiveTasks();
    loadActiveTasks.context.state.activeConversationId = "conversation-b";
    await promise;

    expect(loadActiveTasks.context.state.tasks).toEqual([{ id: "visible-b" }]);
    expect(loadActiveTasks.context.state.conversations).toEqual([]);
  });

  it("does not pull the user back when a send response arrives after switching conversations", async () => {
    const sendPendingRecord = loadFunction("sendPendingRecord", {
      state: { activeConversationId: "conversation-b" },
      api: async () => ({ task: { id: "task-a", conversationId: "conversation-a" } }),
      applyMobileEvent: () => undefined,
      createLocalTaskEvent: () => ({}),
      persistPendingSends: () => undefined,
      persistSelection: () => undefined,
      renderAll: () => undefined
    });

    await sendPendingRecord({
      clientMessageId: "phone-message-a",
      projectId: "openclaw",
      conversationId: "conversation-a",
      mode: "codex",
      prompt: "继续 A",
      source: "panel"
    });

    expect(sendPendingRecord.context.state.activeConversationId).toBe("conversation-b");
  });
});

function loadFunction(name: string, context: Record<string, unknown>): any {
  const source = fs.readFileSync("public/app.js", "utf8");
  const code = extractFunction(source, name);
  const sandbox = { ...context, loaded: undefined as unknown };
  vm.runInNewContext(`${code}\nthis.loaded = ${name};`, sandbox);
  const loaded = sandbox.loaded as any;
  loaded.context = sandbox;
  return loaded;
}

function extractFunction(source: string, name: string): string {
  const asyncStart = source.indexOf(`async function ${name}`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`function not found: ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`function body not closed: ${name}`);
}
