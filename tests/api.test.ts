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
  }
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", createApiRouter({ config, store: new TaskStore() }));
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
});
