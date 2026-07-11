import http from "node:http";
import { AddressInfo } from "node:net";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { attachAgentWebSocketServer } from "../src/server/agentWs.js";
import { TaskStore } from "../src/server/taskStore.js";
import type { DispatcherConfig } from "../src/shared/types.js";

const config: DispatcherConfig = {
  server: { host: "127.0.0.1", port: 0, publicBaseUrl: "http://127.0.0.1:0" },
  auth: { dispatcherToken: "panel-token", agentToken: "agent-token" },
  projects: [
    {
      id: "openclaw",
      name: "OpenClaw",
      path: "D:/aixm/openclaw",
      defaultMode: "codex",
      allowedModes: ["codex"],
      notify: true
    }
  ],
  projectDiscovery: {
    enabled: false,
    roots: ["D:/aixm"],
    exclude: ["beifen"],
    defaultMode: "codex",
    allowedModes: ["codex"],
    notify: true
  },
  codex: { command: "codex", args: ["exec", "{{prompt}}"], promptStdin: false },
  codexAppServer: {
    enabled: false,
    url: "ws://127.0.0.1:18765",
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

let server: http.Server | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.close();
    socket.terminate();
  }
  if (!server) {
    return;
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

describe("agent websocket", () => {
  it("records Codex service health from authenticated heartbeats", async () => {
    const store = new TaskStore();
    server = http.createServer();
    attachAgentWebSocketServer({ server, config, store });
    await listen(server);

    const ws = trackSocket(new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/agents`));
    await onceOpen(ws);
    ws.send(JSON.stringify({ type: "agent.hello", agentId: "LEI-PC", token: "agent-token" }));
    await onceMessage(ws);
    sendReadyHeartbeat(ws);
    await waitFor(() => store.listAgents()[0]?.codex?.ready === true);

    expect(store.listAgents()[0].codex).toMatchObject({ ready: true, phase: "ready" });
  });

  it("settles stale active tasks when the same agent reconnects", async () => {
    const store = new TaskStore();
    const task = store.createTask({ projectId: "openclaw", prompt: "stuck", mode: "codex", source: "panel" });
    store.assignNextTask("LEI-PC");

    server = http.createServer();
    attachAgentWebSocketServer({ server, config, store });
    await listen(server);

    const ws = trackSocket(new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/agents`));
    await onceOpen(ws);
    ws.send(JSON.stringify({ type: "agent.hello", agentId: "LEI-PC", token: "agent-token" }));
    await onceMessage(ws);
    ws.close();

    expect(store.getTask(task.id)?.status).toBe("failed");
    expect(store.getTask(task.id)?.error).toContain("重新连接");
  });

  it("keeps the active task running when a duplicate agent connects while the first connection is alive", async () => {
    const store = new TaskStore();
    const task = store.createTask({ projectId: "openclaw", prompt: "active", mode: "codex", source: "panel" });

    server = http.createServer();
    attachAgentWebSocketServer({ server, config, store });
    await listen(server);
    const port = (server.address() as AddressInfo).port;

    const first = trackSocket(new WebSocket(`ws://127.0.0.1:${port}/agents`));
    await onceOpen(first);
    first.send(JSON.stringify({ type: "agent.hello", agentId: "LEI-PC", token: "agent-token" }));
    await onceMessage(first);
    sendReadyHeartbeat(first);
    await waitFor(() => store.getTask(task.id)?.status === "running");
    expect(store.getTask(task.id)?.status).toBe("running");

    const duplicate = trackSocket(new WebSocket(`ws://127.0.0.1:${port}/agents`));
    await onceOpen(duplicate);
    const duplicateResponse = onceMessage(duplicate);
    duplicate.send(JSON.stringify({ type: "agent.hello", agentId: "LEI-PC", token: "agent-token" }));
    const response = (await duplicateResponse) as { type?: string; message?: string };

    expect(response).toMatchObject({ type: "error" });
    expect(response.message).toMatch(/already connected/i);
    expect(store.getTask(task.id)?.status).toBe("running");

    first.close();
    duplicate.close();
  });

  it("assigns queued tasks from different bound windows to one agent connection", async () => {
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
    const firstConversation = store.createConversation({ projectId: "openclaw", title: "A" });
    const secondConversation = store.createConversation({ projectId: "openclaw", title: "B" });
    store.bindConversationRefreshWindow(firstConversation.id, "LEI-PC:pid:111");
    store.bindConversationRefreshWindow(secondConversation.id, "LEI-PC:pid:222");
    const firstTask = store.createTask({ projectId: "openclaw", conversationId: firstConversation.id, prompt: "A", mode: "codex", source: "panel" });
    const secondTask = store.createTask({ projectId: "openclaw", conversationId: secondConversation.id, prompt: "B", mode: "codex", source: "panel" });

    server = http.createServer();
    attachAgentWebSocketServer({ server, config, store });
    await listen(server);

    const ws = trackSocket(new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/agents`));
    await onceOpen(ws);
    const assignedPromise = collectMessages(ws, 2, (message) => message.type === "task.assigned");
    ws.send(JSON.stringify({ type: "agent.hello", agentId: "LEI-PC", token: "agent-token" }));
    await onceMessage(ws);
    sendReadyHeartbeat(ws);
    const assigned = await assignedPromise;

    expect(assigned.map((message) => message.task.id).sort()).toEqual([firstTask.id, secondTask.id].sort());
    expect(store.getTask(firstTask.id)?.status).toBe("running");
    expect(store.getTask(secondTask.id)?.status).toBe("running");

    ws.close();
  });
});

function sendReadyHeartbeat(ws: WebSocket): void {
  ws.send(JSON.stringify({
    type: "agent.heartbeat",
    sentAt: "2026-07-11T01:30:00.000Z",
    codex: {
      phase: "ready",
      ready: true,
      checkedAt: "2026-07-11T01:30:00.000Z",
      endpoint: "ws://127.0.0.1:18765"
    }
  }));
}

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function onceOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function onceMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    ws.once("error", reject);
  });
}

function trackSocket(ws: WebSocket): WebSocket {
  sockets.push(ws);
  return ws;
}

function collectMessages(
  ws: WebSocket,
  count: number,
  predicate: (message: any) => boolean
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const matches: any[] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${count} messages`));
    }, 1000);
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) {
        return;
      }
      matches.push(message);
      if (matches.length === count) {
        cleanup();
        resolve(matches);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };
    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met");
}
