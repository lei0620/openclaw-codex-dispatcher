import os from "node:os";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { loadDispatcherConfig } from "../shared/config.js";
import type { DispatcherServerMessage } from "../shared/types.js";
import type { ProjectConfig } from "../shared/types.js";
import { readRecentCodexConversations } from "./codexSessions.js";
import { discoverProjects } from "./projectDiscovery.js";
import { runCodexTask } from "./runner.js";

const config = loadDispatcherConfig();
const agentId = process.env.OPENCLAW_AGENT_ID ?? os.hostname();
const dispatcherUrl = process.env.OPENCLAW_DISPATCHER_URL ?? config.server.publicBaseUrl;
const wsUrl = dispatcherUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/$/, "") + "/agents";

let currentAbort: AbortController | undefined;
let projectScanTimer: NodeJS.Timeout | undefined;
let codexConversationSyncTimer: NodeJS.Timeout | undefined;
let lastProjects: ProjectConfig[] = [];
let lastConversationSignature = "";
const approvalResolvers = new Map<string, (approved: boolean) => void>();

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
      syncAgentState(ws);
      projectScanTimer = setInterval(() => {
        lastProjects = sendProjects(ws);
      }, Number(process.env.OPENCLAW_PROJECT_SCAN_INTERVAL_MS ?? 60000));
      codexConversationSyncTimer = setInterval(() => {
        sendCodexConversations(ws, lastProjects);
      }, Number(process.env.OPENCLAW_CODEX_SYNC_INTERVAL_MS ?? 2500));
      return;
    }
    if (message.type === "agent.syncCodexSessions") {
      lastProjects = sendProjects(ws);
      sendCodexConversations(ws, lastProjects, true);
      return;
    }
    if (message.type === "task.assigned") {
      void handleTask(ws, message);
      return;
    }
    if (message.type === "task.cancelled" && currentAbort) {
      currentAbort.abort();
      for (const resolve of approvalResolvers.values()) {
        resolve(false);
      }
      approvalResolvers.clear();
      return;
    }
    if (message.type === "task.approval.resolved") {
      const resolve = approvalResolvers.get(message.approvalId);
      if (resolve) {
        approvalResolvers.delete(message.approvalId);
        resolve(message.decision === "approved");
      }
      return;
    }
    if (message.type === "error") {
      console.error(message.message);
    }
  });

  ws.on("close", () => {
    currentAbort?.abort();
    for (const resolve of approvalResolvers.values()) {
      resolve(false);
    }
    approvalResolvers.clear();
    if (projectScanTimer) {
      clearInterval(projectScanTimer);
      projectScanTimer = undefined;
    }
    if (codexConversationSyncTimer) {
      clearInterval(codexConversationSyncTimer);
      codexConversationSyncTimer = undefined;
    }
    lastProjects = [];
    lastConversationSignature = "";
    currentAbort = undefined;
    setTimeout(connect, Number(process.env.OPENCLAW_AGENT_RECONNECT_MS ?? 5000));
  });

  ws.on("error", (error) => {
    console.error("agent websocket error", error);
  });
}

function syncAgentState(ws: WebSocket): void {
  lastProjects = sendProjects(ws);
  sendCodexConversations(ws, lastProjects, true);
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
  const signature = JSON.stringify(
    conversations.map((conversation) => ({
      projectId: conversation.projectId,
      sessionId: conversation.sessionId,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages
    }))
  );
  if (!force && signature === lastConversationSignature) {
    return;
  }
  lastConversationSignature = signature;
  ws.send(JSON.stringify({ type: "agent.codexConversations", conversations }));
  console.log(`reported ${conversations.length} Codex conversations`);
}

async function handleTask(ws: WebSocket, message: Extract<DispatcherServerMessage, { type: "task.assigned" }>): Promise<void> {
  currentAbort = new AbortController();
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
      currentAbort.signal,
      (stream, text) => {
        send({ type: "task.log", taskId: message.task.id, stream, text });
      },
      async (approvalMessage) => requestApproval(send, message.task, approvalMessage)
    );
    if (currentAbort.signal.aborted) {
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
    currentAbort = undefined;
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
    approvalResolvers.set(approvalId, resolve);
  });
}
