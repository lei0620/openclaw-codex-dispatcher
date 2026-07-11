import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApiRouter } from "../src/server/api.js";
import { TaskStore } from "../src/server/taskStore.js";
import type { DispatcherConfig } from "../src/shared/types.js";

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
    command: "codex",
    args: ["exec", "{{prompt}}"],
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

function buildApp() {
  return buildAppWithStore(new TaskStore());
}

function buildAppWithStore(store: TaskStore) {
  return buildAppWithStoreAndConfig(store, config);
}

function buildAppWithStoreAndConfig(store: TaskStore, dispatcherConfig: DispatcherConfig) {
  const app = express();
  app.use(express.json());
  app.use("/api", createApiRouter({ config: dispatcherConfig, store }));
  return app;
}

describe("task api", () => {
  it("reports NAS, agent, and Codex service health", async () => {
    const store = new TaskStore();
    store.upsertAgent("LEI-PC");
    store.heartbeatAgent("LEI-PC", {
      phase: "ready",
      ready: true,
      checkedAt: "2026-07-11T01:30:00.000Z",
      endpoint: "ws://127.0.0.1:18765"
    });

    const response = await request(buildAppWithStore(store))
      .get("/api/health")
      .set("Authorization", "Bearer panel-token")
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      services: {
        nas: { reachable: true },
        agents: { online: 1 },
        codex: { ready: 1 }
      }
    });
  });

  it("creates a task for a whitelisted project", async () => {
    const response = await request(buildApp())
      .post("/api/tasks")
      .set("Authorization", "Bearer panel-token")
      .send({ projectId: "openclaw", prompt: "explain this repo", mode: "codex", source: "panel" })
      .expect(201);

    expect(response.body.task).toMatchObject({
      projectId: "openclaw",
      prompt: "explain this repo",
      status: "queued"
    });
  });

  it("rejects missing panel token", async () => {
    await request(buildApp()).post("/api/tasks").send({ projectId: "openclaw", prompt: "x" }).expect(401);
  });

  it("rejects a non-whitelisted project", async () => {
    await request(buildApp())
      .post("/api/tasks")
      .set("Authorization", "Bearer panel-token")
      .send({ projectId: "outside", prompt: "x" })
      .expect(400);
  });

  it("requires a window binding before sending a synced Codex conversation when multiple windows are online", async () => {
    const store = new TaskStore();
    const desktopConfig: DispatcherConfig = {
      ...config,
      desktopInput: { ...config.desktopInput, enabled: true }
    };
    const app = buildAppWithStoreAndConfig(store, desktopConfig);
    store.upsertAgent("LEI-PC");
    store.setAgentCodexWindows("LEI-PC", [
      {
        id: "LEI-PC:hwnd:1001",
        agentId: "LEI-PC",
        handle: "1001",
        processId: 111,
        title: "Codex A",
        updatedAt: new Date().toISOString()
      },
      {
        id: "LEI-PC:hwnd:1002",
        agentId: "LEI-PC",
        handle: "1002",
        processId: 222,
        title: "Codex B",
        updatedAt: new Date().toISOString()
      }
    ]);
    store.upsertCodexConversations([
      {
        projectId: "openclaw",
        sessionId: "019f189f-7aaf-7c71-9672-ff51afa6bb90",
        title: "电脑对话 B",
        updatedAt: new Date().toISOString(),
        messages: []
      }
    ]);

    const response = await request(app)
      .post("/api/tasks")
      .set("Authorization", "Bearer panel-token")
      .send({
        projectId: "openclaw",
        conversationId: "codex:019f189f-7aaf-7c71-9672-ff51afa6bb90",
        prompt: "不要发到当前窗口",
        mode: "codex",
        source: "panel"
      })
      .expect(409);

    expect(response.body.error).toContain("先给这个对话绑定一个电脑窗口");
    expect(store.listTasks()).toHaveLength(0);
  });

  it("lists and resolves pending approvals", async () => {
    const store = new TaskStore();
    const app = buildAppWithStore(store);
    const task = store.createTask({
      projectId: "openclaw",
      prompt: "需要授权",
      mode: "codex",
      source: "panel"
    });
    store.requestApproval({
      id: "approval-1",
      taskId: task.id,
      projectId: "openclaw",
      message: "Run command?\n[y/n]",
      status: "pending",
      createdAt: new Date().toISOString()
    });

    const pending = await request(app).get("/api/approvals?status=pending").set("Authorization", "Bearer panel-token").expect(200);
    expect(pending.body.approvals).toHaveLength(1);

    await request(app).post("/api/approvals/approval-1/approve").set("Authorization", "Bearer panel-token").expect(200);
    expect(store.getTask(task.id)?.status).toBe("running");
  });

  it("creates a simulated approval without running a task", async () => {
    const store = new TaskStore();
    const app = buildAppWithStore(store);

    const created = await request(app)
      .post("/api/approvals/simulate")
      .set("Authorization", "Bearer panel-token")
      .send({ projectId: "openclaw", message: "模拟权限测试" })
      .expect(201);

    expect(created.body.approval.status).toBe("pending");
    expect(created.body.approval.taskId).toContain("simulated-");
    expect(store.listTasks()).toHaveLength(0);

    const pending = await request(app).get("/api/approvals?status=pending").set("Authorization", "Bearer panel-token").expect(200);
    expect(pending.body.approvals).toHaveLength(1);
  });
});
