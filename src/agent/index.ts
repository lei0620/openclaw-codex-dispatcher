import os from "node:os";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { loadDispatcherConfig } from "../shared/config.js";
import type { AgentClientMessage, DispatcherServerMessage } from "../shared/types.js";
import type { ProjectConfig } from "../shared/types.js";
import { CodexAppServerSupervisor } from "./codexAppServerSupervisor.js";
import { listCodexDesktopWindows } from "./codexWindows.js";
import { readRecentCodexConversations } from "./codexSessions.js";
import { discoverProjects } from "./projectDiscovery.js";
import { runCodexTask } from "./runner.js";

const config = loadDispatcherConfig();
const agentId = process.env.OPENCLAW_AGENT_ID ?? os.hostname();
const dispatcherUrl = process.env.OPENCLAW_DISPATCHER_URL ?? config.server.publicBaseUrl;
const wsUrl = dispatcherUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/$/, "") + "/agents";
const appServerSupervisor = new CodexAppServerSupervisor(config.codexAppServer);
appServerSupervisor.start();

const activeTasks = new Map<string, AbortController>();
let projectScanTimer: NodeJS.Timeout | undefined;
let codexConversationSyncTimer: NodeJS.Timeout | undefined;
let codexWindowSyncTimer: NodeJS.Timeout | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;
let lastProjects: ProjectConfig[] = [];
let lastConversationSignature = "";
let lastWindowSignature = "";
const approvalResolvers = new Map<string, { taskId: string; resolve: (approved: boolean) => void }>();

connect();

function connect(): void {
  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "agent.hello", agentId, token: config.auth.agentToken }));
  });

  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as DispatcherServerMessage;
    if (message.type === "agent.accepted") {
      console.log(`agent accepted as ${message.agentId}`);
      const sendHeartbeat = (): void => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
          type: "agent.heartbeat",
          sentAt: new Date().toISOString(),
          codex: appServerSupervisor.getStatus()
        } satisfies AgentClientMessage));
      };
      sendHeartbeat();
      heartbeatTimer = setInterval(
        sendHeartbeat,
        config.codexAppServer.heartbeatIntervalMs ?? 10000
      );
      syncAgentState(ws);
      projectScanTimer = setInterval(() => {
        lastProjects = sendProjects(ws);
      }, Number(process.env.OPENCLAW_PROJECT_SCAN_INTERVAL_MS ?? 60000));
      codexConversationSyncTimer = setInterval(() => {
        sendCodexConversations(ws, lastProjects);
      }, Number(process.env.OPENCLAW_CODEX_SYNC_INTERVAL_MS ?? 2500));
      codexWindowSyncTimer = setInterval(() => {
        void sendCodexWindows(ws);
      }, Number(process.env.OPENCLAW_CODEX_WINDOW_SYNC_INTERVAL_MS ?? 2500));
      return;
    }
    if (message.type === "agent.syncCodexSessions") {
      lastProjects = sendProjects(ws);
      sendCodexConversations(ws, lastProjects, true);
      void sendCodexWindows(ws, true);
      return;
    }
    if (message.type === "task.assigned") {
      void handleTask(ws, message);
      return;
    }
    if (message.type === "task.cancelled") {
      activeTasks.get(message.taskId)?.abort();
      resolveApprovalsForTask(message.taskId, false);
      return;
    }
    if (message.type === "task.approval.resolved") {
      const pending = approvalResolvers.get(message.approvalId);
      if (pending) {
        approvalResolvers.delete(message.approvalId);
        pending.resolve(message.decision === "approved");
      }
      return;
    }
    if (message.type === "error") {
      console.error(message.message);
    }
  });

  ws.on("close", () => {
    abortAllActiveTasks();
    resolveAllApprovals(false);
    approvalResolvers.clear();
    if (projectScanTimer) {
      clearInterval(projectScanTimer);
      projectScanTimer = undefined;
    }
    if (codexConversationSyncTimer) {
      clearInterval(codexConversationSyncTimer);
      codexConversationSyncTimer = undefined;
    }
    if (codexWindowSyncTimer) {
      clearInterval(codexWindowSyncTimer);
      codexWindowSyncTimer = undefined;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
    lastProjects = [];
    lastConversationSignature = "";
    lastWindowSignature = "";
    setTimeout(connect, Number(process.env.OPENCLAW_AGENT_RECONNECT_MS ?? 5000));
  });

  ws.on("error", (error) => {
    console.error("agent websocket error", error);
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    appServerSupervisor.stop();
    process.exit(0);
  });
}

function syncAgentState(ws: WebSocket): void {
  lastProjects = sendProjects(ws);
  sendCodexConversations(ws, lastProjects, true);
  void sendCodexWindows(ws, true);
}

function sendProjects(ws: WebSocket): ProjectConfig[] {
  const projects = discoverProjects(config.projectDiscovery);
  if (ws.readyState !== WebSocket.OPEN) {
    return projects;
  }
  ws.send(JSON.stringify({ type: "agent.projects", projects }));
  if (config.projectDiscovery.enabled) {
    console.log(`reported ${projects.length} discovered projects`);
  }
  return projects;
}

function sendCodexConversations(ws: WebSocket, projects: ProjectConfig[], force = false): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  const conversations = readRecentCodexConversations(projects);
  const projectIds = projects.map((project) => project.id);
  const signature = JSON.stringify(
    {
      projectIds,
      conversations: conversations.map((conversation) => ({
        projectId: conversation.projectId,
        sessionId: conversation.sessionId,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages
      }))
    }
  );
  if (!force && signature === lastConversationSignature) {
    return;
  }
  lastConversationSignature = signature;
  ws.send(JSON.stringify({ type: "agent.codexConversations", conversations, projectIds }));
  console.log(`reported ${conversations.length} Codex conversations`);
}

async function sendCodexWindows(ws: WebSocket, force = false): Promise<void> {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  try {
    const windows = await listCodexDesktopWindows(agentId);
    const signature = JSON.stringify(windows.map((window) => ({
      id: window.id,
      handle: window.handle,
      processId: window.processId,
      title: window.title
    })));
    if (!force && signature === lastWindowSignature) {
      return;
    }
    lastWindowSignature = signature;
    ws.send(JSON.stringify({ type: "agent.codexWindows", windows }));
    console.log(`reported ${windows.length} Codex desktop windows`);
  } catch (error) {
    console.error("failed to report Codex desktop windows", error);
  }
}

async function handleTask(ws: WebSocket, message: Extract<DispatcherServerMessage, { type: "task.assigned" }>): Promise<void> {
  const abortController = new AbortController();
  activeTasks.set(message.task.id, abortController);
  const send = (payload: unknown) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  try {
    const result = await runCodexTask(
      message.codex,
      config.codexAppServer,
      config.desktopInput,
      message.task,
      message.project,
      abortController.signal,
      (stream, text) => {
        send({ type: "task.log", taskId: message.task.id, stream, text });
      },
      async (approvalMessage) => requestApproval(send, message.task, approvalMessage)
    );
    if (abortController.signal.aborted) {
      send({ type: "task.cancelled", taskId: message.task.id, reason: "cancelled by dispatcher" });
    } else if (result.exitCode === 0) {
      send({ type: "task.result", taskId: message.task.id, result });
    } else {
      send({ type: "task.failed", taskId: message.task.id, error: result.summary });
    }
  } catch (error) {
    send({ type: "task.failed", taskId: message.task.id, error: error instanceof Error ? error.message : String(error) });
  } finally {
    lastProjects = discoverProjects(config.projectDiscovery);
    sendCodexConversations(ws, lastProjects, true);
    void sendCodexWindows(ws, true);
    if (activeTasks.get(message.task.id) === abortController) {
      activeTasks.delete(message.task.id);
    }
    resolveApprovalsForTask(message.task.id, false);
  }
}

function requestApproval(
  send: (payload: unknown) => void,
  task: Extract<DispatcherServerMessage, { type: "task.assigned" }>["task"],
  message: string
): Promise<boolean> {
  const approvalId = randomUUID();
  send({
    type: "task.approval.requested",
    approval: {
      id: approvalId,
      taskId: task.id,
      projectId: task.projectId,
      message,
      status: "pending",
      createdAt: new Date().toISOString()
    }
  });
  return new Promise((resolve) => {
    approvalResolvers.set(approvalId, { taskId: task.id, resolve });
  });
}

function abortAllActiveTasks(): void {
  for (const controller of activeTasks.values()) {
    controller.abort();
  }
  activeTasks.clear();
}

function resolveApprovalsForTask(taskId: string, approved: boolean): void {
  for (const [approvalId, pending] of approvalResolvers.entries()) {
    if (pending.taskId !== taskId) {
      continue;
    }
    approvalResolvers.delete(approvalId);
    pending.resolve(approved);
  }
}

function resolveAllApprovals(approved: boolean): void {
  for (const pending of approvalResolvers.values()) {
    pending.resolve(approved);
  }
}
