import os from "node:os";
import WebSocket from "ws";
import { loadDispatcherConfig } from "../shared/config.js";
import type { DispatcherServerMessage } from "../shared/types.js";
import { discoverProjects } from "./projectDiscovery.js";
import { runCodexTask } from "./runner.js";

const config = loadDispatcherConfig();
const agentId = process.env.OPENCLAW_AGENT_ID ?? os.hostname();
const dispatcherUrl = process.env.OPENCLAW_DISPATCHER_URL ?? config.server.publicBaseUrl;
const wsUrl = dispatcherUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/$/, "") + "/agents";

let currentAbort: AbortController | undefined;
let projectScanTimer: NodeJS.Timeout | undefined;

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
      sendProjects(ws);
      projectScanTimer = setInterval(() => sendProjects(ws), Number(process.env.OPENCLAW_PROJECT_SCAN_INTERVAL_MS ?? 60000));
      return;
    }
    if (message.type === "task.assigned") {
      void handleTask(ws, message);
      return;
    }
    if (message.type === "task.cancelled" && currentAbort) {
      currentAbort.abort();
      return;
    }
    if (message.type === "error") {
      console.error(message.message);
    }
  });

  ws.on("close", () => {
    currentAbort?.abort();
    if (projectScanTimer) {
      clearInterval(projectScanTimer);
      projectScanTimer = undefined;
    }
    currentAbort = undefined;
    setTimeout(connect, Number(process.env.OPENCLAW_AGENT_RECONNECT_MS ?? 5000));
  });

  ws.on("error", (error) => {
    console.error("agent websocket error", error);
  });
}

function sendProjects(ws: WebSocket): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  const projects = discoverProjects(config.projectDiscovery);
  ws.send(JSON.stringify({ type: "agent.projects", projects }));
  if (config.projectDiscovery.enabled) {
    console.log(`reported ${projects.length} discovered projects`);
  }
}

async function handleTask(ws: WebSocket, message: Extract<DispatcherServerMessage, { type: "task.assigned" }>): Promise<void> {
  currentAbort = new AbortController();
  const send = (payload: unknown) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  try {
    const result = await runCodexTask(message.codex, message.task, message.project, currentAbort.signal, (stream, text) => {
      send({ type: "task.log", taskId: message.task.id, stream, text });
    });
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
    currentAbort = undefined;
  }
}
