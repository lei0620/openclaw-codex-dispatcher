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

function buildApp() {
  return buildAppWithStore(new TaskStore());
}

function buildAppWithStore(store: TaskStore) {
  const app = express();
  app.use(express.json());
  app.use("/api", createApiRouter({ config, store }));
  return app;
}

describe("task api", () => {
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
});
