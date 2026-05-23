import type http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { AgentClientMessage, DispatcherConfig, DispatcherServerMessage, ProjectConfig, TaskRecord } from "../shared/types.js";
import { resolveProject } from "../shared/pathPolicy.js";
import type { TaskStore } from "./taskStore.js";

interface AgentWsDeps {
  server: http.Server;
  config: DispatcherConfig;
  store: TaskStore;
}

export function attachAgentWebSocketServer({ server, config, store }: AgentWsDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const agents = new Map<string, WebSocket>();

  server.on("upgrade", (request, socket, head) => {
    if (!request.url?.startsWith("/agents")) {
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  store.onStoreEvent("task.created", () => {
    assignQueuedTasks(config, store, agents);
  });

  store.onStoreEvent("task.cancelRequested", (record) => {
    const task = record as TaskRecord;
    if (task.agentId) {
      send(agents.get(task.agentId), { type: "task.cancelled", taskId: task.id });
    }
  });

  wss.on("connection", (ws) => {
    let agentId: string | undefined;

    ws.once("message", (data) => {
      const message = parseMessage(data);
      if (!message || message.type !== "agent.hello" || message.token !== config.auth.agentToken) {
        send(ws, { type: "error", message: "invalid agent hello" });
        ws.close(1008, "invalid agent token");
        return;
      }
      agentId = message.agentId;
      agents.set(agentId, ws);
      store.upsertAgent(agentId);
      send(ws, { type: "agent.accepted", agentId });
      assignQueuedTasks(config, store, agents);

      ws.on("message", (payload) => {
        handleAgentMessage(config, store, agentId!, parseMessage(payload), agents);
      });
    });

    ws.on("close", () => {
      if (!agentId) {
        return;
      }
      agents.delete(agentId);
      store.markAgentOffline(agentId);
    });
  });

  return wss;
}

function handleAgentMessage(
  config: DispatcherConfig,
  store: TaskStore,
  agentId: string,
  message: AgentClientMessage | undefined,
  agents: Map<string, WebSocket>
): void {
  if (!message) {
    return;
  }
  store.upsertAgent(agentId);
  if (message.type === "task.log") {
    store.appendLog(message.taskId, message.stream, message.text);
  }
  if (message.type === "agent.projects") {
    store.setAgentProjects(agentId, message.projects);
  }
  if (message.type === "task.result") {
    store.completeTask(message.taskId, message.result);
    assignQueuedTasks(config, store, agents);
  }
  if (message.type === "task.failed") {
    store.failTask(message.taskId, message.error);
    assignQueuedTasks(config, store, agents);
  }
  if (message.type === "task.cancelled") {
    store.markCancelled(message.taskId, message.reason);
    assignQueuedTasks(config, store, agents);
  }
}

function assignQueuedTasks(config: DispatcherConfig, store: TaskStore, agents: Map<string, WebSocket>): void {
  for (const [agentId, ws] of agents.entries()) {
    if (ws.readyState !== WebSocket.OPEN) {
      continue;
    }
    const task = store.assignNextTask(agentId);
    if (!task) {
      return;
    }
    const project = resolveProject(store.listProjects(config.projects), task.projectId, task.mode);
    send(ws, {
      type: "task.assigned",
      task,
      project: project satisfies ProjectConfig,
      codex: config.codex
    });
  }
}

function parseMessage(data: WebSocket.RawData): AgentClientMessage | undefined {
  try {
    return JSON.parse(data.toString()) as AgentClientMessage;
  } catch {
    return undefined;
  }
}

function send(ws: WebSocket | undefined, message: DispatcherServerMessage): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}
