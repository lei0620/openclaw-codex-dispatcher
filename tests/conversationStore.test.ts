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
    startupTimeoutMs: 60000,
    requestTimeoutMs: 30000,
    turnTimeoutMs: 120000
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
  it("updates agent last-seen and Codex health from a heartbeat", () => {
    const store = new TaskStore();
    store.upsertAgent("LEI-PC");
    store.heartbeatAgent(
      "LEI-PC",
      {
        phase: "ready",
        ready: true,
        checkedAt: "2026-07-11T01:30:00.000Z",
        endpoint: "ws://127.0.0.1:18765"
      },
      "2026-07-11T01:30:00.000Z"
    );

    expect(store.listAgents()[0]).toMatchObject({
      id: "LEI-PC",
      online: true,
      lastSeenAt: "2026-07-11T01:30:00.000Z",
      codex: { ready: true, phase: "ready" }
    });
  });

  it("marks agents offline after the heartbeat deadline", () => {
    const store = new TaskStore();
    store.upsertAgent("LEI-PC");
    store.heartbeatAgent(
      "LEI-PC",
      {
        phase: "ready",
        ready: true,
        checkedAt: "2026-07-11T01:30:00.000Z",
        endpoint: "ws://127.0.0.1:18765"
      },
      "2026-07-11T01:30:00.000Z"
    );

    store.markStaleAgentsOffline(30000, Date.parse("2026-07-11T01:30:31.000Z"));

    expect(store.listAgents()[0].online).toBe(false);
  });

  it("allows assignment only while the agent and Codex service are ready", () => {
    const store = new TaskStore();
    store.upsertAgent("LEI-PC");
    expect(store.isAgentReady("LEI-PC")).toBe(false);

    store.heartbeatAgent(
      "LEI-PC",
      {
        phase: "ready",
        ready: true,
        checkedAt: "2026-07-11T01:30:00.000Z",
        endpoint: "ws://127.0.0.1:18765"
      },
      "2026-07-11T01:30:00.000Z"
    );

    expect(store.isAgentReady("LEI-PC")).toBe(true);
  });

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

  it("settles interrupted active tasks after a dispatcher restart and releases their slots", () => {
    const file = statePath();
    const first = new TaskStore(file);
    const runningConversation = first.createConversation({ projectId: "openclaw", title: "执行中" });
    const cancellingConversation = first.createConversation({ projectId: "openclaw", title: "取消中" });
    const approvalConversation = first.createConversation({ projectId: "openclaw", title: "等授权" });
    const running = first.createTask({
      projectId: "openclaw",
      conversationId: runningConversation.id,
      prompt: "running",
      mode: "codex",
      source: "panel"
    });
    const cancelling = first.createTask({
      projectId: "openclaw",
      conversationId: cancellingConversation.id,
      prompt: "cancelling",
      mode: "codex",
      source: "panel"
    });
    const waiting = first.createTask({
      projectId: "openclaw",
      conversationId: approvalConversation.id,
      prompt: "waiting",
      mode: "codex",
      source: "panel"
    });
    const queued = first.createTask({
      projectId: "openclaw",
      conversationId: runningConversation.id,
      prompt: "next",
      mode: "codex",
      source: "panel"
    });

    expect(first.assignNextTask("LEI-PC")?.id).toBe(running.id);
    expect(first.assignNextTask("LEI-PC")?.id).toBe(cancelling.id);
    expect(first.assignNextTask("LEI-PC")?.id).toBe(waiting.id);
    first.requestCancel(cancelling.id);
    first.requestApproval({
      id: "approval-before-restart",
      taskId: waiting.id,
      projectId: "openclaw",
      message: "允许命令吗",
      status: "pending",
      createdAt: new Date().toISOString()
    });
    const cursorBeforeRestart = first.getLatestMobileEventId();

    const reloaded = new TaskStore(file);
    const recoveryEvents = reloaded.getMobileEventWindow(cursorBeforeRestart).events;

    expect(reloaded.getTask(running.id)).toMatchObject({
      status: "failed",
      error: "NAS 服务重启，原执行进程已中断，请重新发送。"
    });
    expect(reloaded.getTask(cancelling.id)).toMatchObject({
      status: "cancelled",
      error: "NAS 服务重启时任务正在取消。"
    });
    expect(reloaded.getTask(waiting.id)).toMatchObject({
      status: "failed",
      error: "NAS 服务重启时仍在等待授权，请重新发送。",
      pendingApproval: undefined
    });
    expect(reloaded.getTask(running.id)?.finishedAt).toBeTruthy();
    expect(reloaded.getTask(cancelling.id)?.finishedAt).toBeTruthy();
    expect(reloaded.getTask(waiting.id)?.finishedAt).toBeTruthy();
    expect(reloaded.assignNextTask("LEI-PC")?.id).toBe(queued.id);

    const persisted = JSON.parse(fs.readFileSync(file, "utf8")) as { tasks: Array<{ id: string; status: string }> };
    expect(persisted.tasks.find((task) => task.id === running.id)?.status).toBe("failed");
    expect(persisted.tasks.find((task) => task.id === cancelling.id)?.status).toBe("cancelled");
    expect(persisted.tasks.find((task) => task.id === waiting.id)?.status).toBe("failed");
    expect(recoveryEvents).toMatchObject([
      { type: "task.updated", taskId: running.id, payload: { task: { status: "failed" } } },
      { type: "task.updated", taskId: cancelling.id, payload: { task: { status: "cancelled" } } },
      { type: "task.updated", taskId: waiting.id, payload: { task: { status: "failed" } } }
    ]);
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

  it("binds a conversation to a specific Codex desktop window and copies it to new tasks", () => {
    const store = new TaskStore();
    store.upsertAgent("LEI-PC");
    store.setAgentCodexWindows("LEI-PC", [
      {
        id: "LEI-PC:pid:24228",
        agentId: "LEI-PC",
        handle: "123456",
        processId: 24228,
        title: "Codex",
        updatedAt: new Date().toISOString()
      }
    ]);
    const conversation = store.createConversation({ projectId: "openclaw", title: "绑定窗口" });

    const updated = store.bindConversationRefreshWindow(conversation.id, "LEI-PC:pid:24228");
    const task = store.createTask({
      projectId: "openclaw",
      conversationId: conversation.id,
      prompt: "只刷新这个窗口",
      mode: "codex",
      source: "panel"
    });

    expect(updated.refreshWindowId).toBe("LEI-PC:pid:24228");
    expect(task.refreshWindowId).toBe("LEI-PC:pid:24228");
  });

  it("auto-binds new Codex tasks to the only online desktop window", () => {
    const store = new TaskStore();
    store.upsertAgent("LEI-PC");
    store.setAgentCodexWindows("LEI-PC", [
      {
        id: "LEI-PC:pid:24228",
        agentId: "LEI-PC",
        handle: "123456",
        processId: 24228,
        title: "Codex",
        updatedAt: new Date().toISOString()
      }
    ]);
    const conversation = store.createConversation({ projectId: "openclaw", title: "自动绑定" });

    const task = store.createTask({
      projectId: "openclaw",
      conversationId: conversation.id,
      prompt: "直接打到唯一窗口",
      mode: "codex",
      source: "panel"
    });

    expect(task.refreshWindowId).toBe("LEI-PC:pid:24228");
    expect(store.getConversation(conversation.id)?.refreshWindowId).toBe("LEI-PC:pid:24228");
  });

  it("clears an old process binding when it maps to multiple live windows", () => {
    const store = new TaskStore();
    store.upsertAgent("LEI-PC");
    store.setAgentCodexWindows("LEI-PC", [
      {
        id: "LEI-PC:hwnd:1001",
        agentId: "LEI-PC",
        handle: "1001",
        processId: 24228,
        title: "Codex A",
        updatedAt: new Date().toISOString()
      },
      {
        id: "LEI-PC:hwnd:1002",
        agentId: "LEI-PC",
        handle: "1002",
        processId: 24228,
        title: "Codex B",
        updatedAt: new Date().toISOString()
      }
    ]);
    const conversation = store.createConversation({ projectId: "openclaw", title: "旧绑定" });
    store.setAgentCodexWindows("LEI-PC", [
      {
        id: "LEI-PC:pid:24228",
        agentId: "LEI-PC",
        handle: "9999",
        processId: 24228,
        title: "Legacy Codex",
        updatedAt: new Date().toISOString()
      }
    ]);
    store.bindConversationRefreshWindow(conversation.id, "LEI-PC:pid:24228");
    store.setAgentCodexWindows("LEI-PC", [
      {
        id: "LEI-PC:hwnd:1001",
        agentId: "LEI-PC",
        handle: "1001",
        processId: 24228,
        title: "Codex A",
        updatedAt: new Date().toISOString()
      },
      {
        id: "LEI-PC:hwnd:1002",
        agentId: "LEI-PC",
        handle: "1002",
        processId: 24228,
        title: "Codex B",
        updatedAt: new Date().toISOString()
      }
    ]);

    const task = store.createTask({
      projectId: "openclaw",
      conversationId: conversation.id,
      prompt: "不要串窗口",
      mode: "codex",
      source: "panel"
    });

    expect(task.refreshWindowId).toBeUndefined();
    expect(store.getConversation(conversation.id)?.refreshWindowId).toBeUndefined();
  });

  it("does not expose stale Codex windows after an agent goes offline", () => {
    const store = new TaskStore();
    store.upsertAgent("LEI-PC");
    store.setAgentCodexWindows("LEI-PC", [
      {
        id: "LEI-PC:pid:24228",
        agentId: "LEI-PC",
        handle: "123456",
        processId: 24228,
        title: "Codex",
        updatedAt: new Date().toISOString()
      }
    ]);

    store.markAgentOffline("LEI-PC");

    expect(store.listCodexWindows()).toEqual([]);
  });

  it("persists Codex window remarks and reapplies them after window refresh", () => {
    const file = statePath();
    const first = new TaskStore(file);
    first.upsertAgent("LEI-PC");
    first.setAgentCodexWindows("LEI-PC", [
      {
        id: "LEI-PC:hwnd:1001",
        agentId: "LEI-PC",
        handle: "1001",
        processId: 24228,
        title: "Codex",
        updatedAt: new Date().toISOString()
      }
    ]);

    first.renameCodexWindow("LEI-PC:hwnd:1001", "openclaw 主窗口");

    const reloaded = new TaskStore(file);
    reloaded.upsertAgent("LEI-PC");
    reloaded.setAgentCodexWindows("LEI-PC", [
      {
        id: "LEI-PC:hwnd:1001",
        agentId: "LEI-PC",
        handle: "1001",
        processId: 24228,
        title: "Codex",
        updatedAt: new Date().toISOString()
      }
    ]);

    expect(reloaded.listCodexWindows()).toMatchObject([{ id: "LEI-PC:hwnd:1001", remark: "openclaw 主窗口" }]);
  });

  it("assigns tasks on different bound Codex windows in parallel but queues the same window", () => {
    const store = new TaskStore();
    store.upsertAgent("LEI-PC");
    store.setAgentCodexWindows("LEI-PC", [
      {
        id: "LEI-PC:pid:111",
        agentId: "LEI-PC",
        handle: "1001",
        processId: 111,
        title: "Codex A",
        updatedAt: new Date().toISOString()
      },
      {
        id: "LEI-PC:pid:222",
        agentId: "LEI-PC",
        handle: "1002",
        processId: 222,
        title: "Codex B",
        updatedAt: new Date().toISOString()
      }
    ]);
    const firstConversation = store.createConversation({ projectId: "openclaw", title: "窗口 A" });
    const secondConversation = store.createConversation({ projectId: "openclaw", title: "窗口 B" });
    const thirdConversation = store.createConversation({ projectId: "openclaw", title: "窗口 A 第二个" });
    store.bindConversationRefreshWindow(firstConversation.id, "LEI-PC:pid:111");
    store.bindConversationRefreshWindow(secondConversation.id, "LEI-PC:pid:222");
    store.bindConversationRefreshWindow(thirdConversation.id, "LEI-PC:pid:111");
    const first = store.createTask({ projectId: "openclaw", conversationId: firstConversation.id, prompt: "A1", mode: "codex", source: "panel" });
    const second = store.createTask({ projectId: "openclaw", conversationId: secondConversation.id, prompt: "B1", mode: "codex", source: "panel" });
    const third = store.createTask({ projectId: "openclaw", conversationId: thirdConversation.id, prompt: "A2", mode: "codex", source: "panel" });

    expect(store.assignNextTask("LEI-PC")?.id).toBe(first.id);
    expect(store.assignNextTask("LEI-PC")?.id).toBe(second.id);
    expect(store.assignNextTask("LEI-PC")).toBeUndefined();
    expect(store.getTask(third.id)?.status).toBe("queued");

    store.completeTask(first.id, { exitCode: 0, summary: "done", diffSummary: "no changes" });

    expect(store.assignNextTask("LEI-PC")?.id).toBe(third.id);
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

  it("binds and clears the refresh window through the conversation api", async () => {
    const app = express();
    const store = new TaskStore();
    app.use(express.json());
    app.use("/api", createApiRouter({ config, store }));
    store.upsertAgent("LEI-PC");
    store.setAgentCodexWindows("LEI-PC", [
      {
        id: "LEI-PC:pid:24228",
        agentId: "LEI-PC",
        handle: "123456",
        processId: 24228,
        title: "Codex",
        updatedAt: new Date().toISOString()
      }
    ]);
    const conversation = store.createConversation({ projectId: "openclaw", title: "绑定窗口" });

    const bound = await request(app)
      .post(`/api/conversations/${conversation.id}/refresh-window`)
      .set("Authorization", "Bearer panel-token")
      .send({ refreshWindowId: "LEI-PC:pid:24228" })
      .expect(200);

    expect(bound.body.conversation.refreshWindowId).toBe("LEI-PC:pid:24228");

    const cleared = await request(app)
      .post(`/api/conversations/${conversation.id}/refresh-window`)
      .set("Authorization", "Bearer panel-token")
      .send({ refreshWindowId: "" })
      .expect(200);

    expect(cleared.body.conversation.refreshWindowId).toBeUndefined();
  });

  it("renames a Codex desktop window through the api", async () => {
    const app = express();
    const store = new TaskStore();
    app.use(express.json());
    app.use("/api", createApiRouter({ config, store }));
    store.upsertAgent("LEI-PC");
    store.setAgentCodexWindows("LEI-PC", [
      {
        id: "LEI-PC:hwnd:1001",
        agentId: "LEI-PC",
        handle: "1001",
        processId: 24228,
        title: "Codex",
        updatedAt: new Date().toISOString()
      }
    ]);

    const renamed = await request(app)
      .post("/api/codex-windows/remark")
      .set("Authorization", "Bearer panel-token")
      .send({ windowId: "LEI-PC:hwnd:1001", remark: "openclaw 主窗口" })
      .expect(200);

    expect(renamed.body.window).toMatchObject({ id: "LEI-PC:hwnd:1001", remark: "openclaw 主窗口" });

    const listed = await request(app)
      .get("/api/codex-windows")
      .set("Authorization", "Bearer panel-token")
      .expect(200);

    expect(listed.body.windows).toMatchObject([{ id: "LEI-PC:hwnd:1001", remark: "openclaw 主窗口" }]);
  });
});
