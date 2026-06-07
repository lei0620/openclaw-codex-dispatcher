import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApiRouter } from "../src/server/api.js";
import { TaskStore } from "../src/server/taskStore.js";
import type { DispatcherConfig } from "../src/shared/types.js";

let tmpDir: string | undefined;

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

const config: DispatcherConfig = {
  server: { host: "127.0.0.1", port: 4318, publicBaseUrl: "http://127.0.0.1:4318" },
  auth: { dispatcherToken: "panel-token", agentToken: "agent-token" },
  projects: [
    {
      id: "openclaw",
      name: "OpenClaw Bridge",
      path: "D:/aixm/openclaw",
      defaultMode: "codex",
      allowedModes: ["codex", "dry-run"],
      notify: true
    }
  ],
  projectDiscovery: {
    enabled: false,
    roots: ["D:/aixm"],
    exclude: ["beifen"],
    defaultMode: "codex",
    allowedModes: ["codex", "dry-run"],
    notify: true
  },
  codex: {
    command: "node",
    args: ["D:/aixm/openclaw/node_modules/@openai/codex/bin/codex.js", "exec", "{{prompt}}"],
    promptStdin: false
  },
  codexAppServer: {
    enabled: false,
    url: "ws://127.0.0.1:8765",
    startupTimeoutMs: 8000,
    requestTimeoutMs: 30000
  },
  desktopInput: {
    enabled: false,
    scriptPath: "scripts/send-codex-desktop-input.ps1",
    clickYOffset: 92,
    windowTitlePattern: "Codex|OpenAI",
    responseTimeoutMs: 180000
  }
};

function statePath() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-state-"));
  return path.join(tmpDir, "state.json");
}

describe("TaskStore conversations", () => {
  it("persists conversations and tasks to a json file", () => {
    const file = statePath();
    const first = new TaskStore(file);
    const conversation = first.createConversation({ projectId: "openclaw", title: "远程控制" });
    const task = first.createTask({
      projectId: "openclaw",
      conversationId: conversation.id,
      prompt: "继续这个对话",
      mode: "dry-run",
      source: "panel"
    });

    const reloaded = new TaskStore(file);

    expect(reloaded.listConversations()).toMatchObject([{ id: conversation.id, projectId: "openclaw" }]);
    expect(reloaded.listTasks(conversation.id)).toMatchObject([{ id: task.id, prompt: "继续这个对话" }]);
  });

  it("binds a phone-created conversation to the desktop Codex session after the first turn", () => {
    const store = new TaskStore();
    const conversation = store.createConversation({ projectId: "openclaw", title: "手机新对话" });
    const firstTask = store.createTask({
      projectId: "openclaw",
      conversationId: conversation.id,
      prompt: "在电脑端创建真实会话",
      mode: "codex",
      source: "panel"
    });

    store.completeTask(firstTask.id, {
      exitCode: 0,
      summary: "完成",
      diffSummary: "no changes",
      codexSessionId: "019ea06b-17d8-7a32-8106-334d3ae55286"
    });

    const secondTask = store.createTask({
      projectId: "openclaw",
      conversationId: conversation.id,
      prompt: "继续同一个电脑端会话",
      mode: "codex",
      source: "panel"
    });

    expect(store.getConversation(conversation.id)).toMatchObject({
      source: "codex",
      codexSessionId: "019ea06b-17d8-7a32-8106-334d3ae55286"
    });
    expect(secondTask.codexSessionId).toBe("019ea06b-17d8-7a32-8106-334d3ae55286");
  });
});

describe("conversation api", () => {
  it("creates conversations and returns only that conversation's tasks", async () => {
    const app = express();
    const store = new TaskStore();
    app.use(express.json());
    app.use("/api", createApiRouter({ config, store }));

    const conversation = await request(app)
      .post("/api/conversations")
      .set("Authorization", "Bearer panel-token")
      .send({ projectId: "openclaw", title: "了解手机远程使用 Codex" })
      .expect(201);

    await request(app)
      .post("/api/tasks")
      .set("Authorization", "Bearer panel-token")
      .send({
        projectId: "openclaw",
        conversationId: conversation.body.conversation.id,
        prompt: "你能做什么",
        mode: "dry-run",
        source: "panel"
      })
      .expect(201);

    const tasks = await request(app)
      .get(`/api/conversations/${conversation.body.conversation.id}/tasks`)
      .set("Authorization", "Bearer panel-token")
      .expect(200);

    expect(tasks.body.tasks).toHaveLength(1);
    expect(tasks.body.tasks[0]).toMatchObject({ prompt: "你能做什么", conversationId: conversation.body.conversation.id });
  });
});
