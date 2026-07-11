import fs from "node:fs";
import path from "node:path";
import { spawn, type SpawnOptions } from "node:child_process";
import WebSocket from "ws";
import type {
  CodexAppServerConfig,
  ProjectConfig,
  TaskLogStream,
  TaskRecord,
  TaskResult
} from "../shared/types.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface JsonRpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
}

export async function runCodexAppServerTask(
  appServer: CodexAppServerConfig,
  threadId: string | undefined,
  task: TaskRecord,
  project: ProjectConfig,
  signal: AbortSignal,
  onLog: (stream: TaskLogStream, text: string) => void,
  onApproval?: (message: string) => Promise<boolean>
): Promise<TaskResult> {
  await ensureAppServer(appServer, onLog);
  const ws = await connectWebSocket(appServer.url, signal, appServer.requestTimeoutMs);
  let nextId = 1;
  let activeThreadId = threadId;
  let turnId: string | undefined;
  let assistantText = "";
  const pending = new Map<number | string, PendingRequest>();

  const sendRaw = (message: unknown) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const request = (method: string, params: unknown): Promise<unknown> => {
    const id = nextId++;
    sendRaw({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, appServer.requestTimeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
  };

  const completed = new Promise<TaskResult>((resolve, reject) => {
    const abort = () => {
      if (activeThreadId && turnId) {
        void request("turn/interrupt", { threadId: activeThreadId, turnId }).catch(() => undefined);
      }
      reject(new Error("cancelled by request"));
      ws.close();
    };
    signal.addEventListener("abort", abort, { once: true });

    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as JsonRpcMessage;
      const pendingRequest = message.id === undefined ? undefined : pending.get(message.id);
      if (pendingRequest && !message.method) {
        clearTimeout(pendingRequest.timer);
        pending.delete(message.id as number | string);
        if (message.error) {
          pendingRequest.reject(new Error(message.error.message ?? "Codex app-server request failed"));
        } else {
          pendingRequest.resolve(message.result);
        }
        return;
      }

      if (message.id !== undefined && message.method) {
        void handleServerRequest(message, sendRaw, onApproval, onLog);
        return;
      }

      if (message.method === "item/agentMessage/delta") {
        const delta = String(message.params?.delta ?? "");
        assistantText += delta;
        if (delta) {
          onLog("stdout", delta);
        }
        return;
      }
      if (
        message.method === "item/commandExecution/outputDelta" ||
        message.method === "command/exec/outputDelta"
      ) {
        const delta = String(message.params?.delta ?? "");
        if (delta) {
          onLog("system", delta);
        }
        return;
      }
      if (message.method === "error") {
        onLog("stderr", `${JSON.stringify(message.params)}\n`);
        return;
      }
      if (message.method === "turn/completed" && message.params?.threadId === activeThreadId) {
        signal.removeEventListener("abort", abort);
        const turn = message.params?.turn as { id?: string; status?: string; error?: { message?: string } | null };
        if (turnId && turn.id !== turnId) {
          return;
        }
        const failed = turn.status && turn.status !== "completed";
        resolve({
          exitCode: failed ? 1 : 0,
          summary: failed
            ? turn.error?.message ?? "Codex desktop turn failed."
            : assistantText.trim() || "Codex desktop turn completed.",
          diffSummary: "not checked",
          codexSessionId: activeThreadId
        });
        ws.close();
      }
    });

    ws.on("close", () => {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Codex app-server connection closed"));
      }
      pending.clear();
      if (!signal.aborted && turnId) {
        reject(new Error("Codex app-server connection closed before the turn completed"));
      }
    });
    ws.on("error", (error) => reject(error));
  });

  try {
    await request("initialize", {
      clientInfo: { name: "openclaw-codex-agent", title: "OpenClaw Codex Agent", version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: [] }
    });
    if (activeThreadId) {
      onLog("system", `desktop app-server: resuming ${activeThreadId}`);
      await request("thread/resume", { threadId: activeThreadId, cwd: project.path });
    } else {
      onLog("system", `desktop app-server: starting new thread in ${project.path}`);
      const started = (await request("thread/start", { cwd: project.path })) as { thread?: { id?: string; sessionId?: string } };
      activeThreadId = started.thread?.id ?? started.thread?.sessionId;
      if (!activeThreadId) {
        throw new Error("Codex app-server did not return a thread id");
      }
    }
    const turnStart = (await request("turn/start", {
      threadId: activeThreadId,
      input: [{ type: "text", text: task.prompt, text_elements: [] }],
      cwd: project.path
    })) as { turn?: { id?: string } };
    turnId = turnStart.turn?.id;
    if (!turnId) {
      throw new Error("Codex app-server did not return a turn id");
    }
    onLog("system", `desktop app-server: started turn ${turnId}`);
    const result = await withTurnTimeout(completed, appServer.turnTimeoutMs, () => {
      onLog("stderr", `desktop app-server turn timed out after ${appServer.turnTimeoutMs}ms\n`);
      if (activeThreadId && turnId) {
        void request("turn/interrupt", { threadId: activeThreadId, turnId }).catch(() => undefined);
      }
      ws.close();
    });
    await refreshDesktopAfterTurn(appServer, task, onLog);
    return result;
  } finally {
    ws.close();
  }
}

function withTurnTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error("Codex desktop turn timed out"));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function handleServerRequest(
  message: JsonRpcMessage,
  sendRaw: (message: unknown) => void,
  onApproval: ((message: string) => Promise<boolean>) | undefined,
  onLog: (stream: TaskLogStream, text: string) => void
): Promise<void> {
  if (message.id === undefined) {
    return;
  }
  if (!onApproval) {
    sendRaw({ id: message.id, error: { code: -32000, message: "approval is not available" } });
    return;
  }
  const approved = await onApproval(formatApprovalMessage(message));
  if (
    message.method === "item/commandExecution/requestApproval" ||
    message.method === "item/fileChange/requestApproval"
  ) {
    sendRaw({ id: message.id, result: { decision: approved ? "accept" : "decline" } });
    return;
  }
  if (message.method === "item/permissions/requestApproval") {
    const requested = message.params?.permissions as Record<string, unknown> | undefined;
    sendRaw({
      id: message.id,
      result: { permissions: approved && requested ? requested : {}, scope: "turn" }
    });
    return;
  }
  onLog("system", `unsupported desktop approval request: ${message.method}`);
  sendRaw({ id: message.id, error: { code: -32601, message: `unsupported request: ${message.method}` } });
}

function formatApprovalMessage(message: JsonRpcMessage): string {
  const params = message.params ?? {};
  if (message.method === "item/commandExecution/requestApproval") {
    return [`Codex wants to run a command.`, `cwd: ${String(params.cwd ?? "")}`, String(params.command ?? "")]
      .filter(Boolean)
      .join("\n");
  }
  if (message.method === "item/fileChange/requestApproval") {
    return [`Codex wants to edit files.`, String(params.reason ?? ""), String(params.grantRoot ?? "")]
      .filter(Boolean)
      .join("\n");
  }
  if (message.method === "item/permissions/requestApproval") {
    return [`Codex wants extra permissions.`, String(params.reason ?? ""), JSON.stringify(params.permissions ?? {})]
      .filter(Boolean)
      .join("\n");
  }
  return `Codex needs approval: ${message.method}`;
}

async function ensureAppServer(
  appServer: CodexAppServerConfig,
  onLog: (stream: TaskLogStream, text: string) => void
): Promise<void> {
  if (await isReady(appServer.url, 1200)) {
    return;
  }
  const command = resolveCodexAppServerCommand(appServer.command);
  onLog("system", `starting desktop app-server on ${appServer.url} with ${command}`);
  const child = spawnAppServer(command, appServer.url);
  child.unref();
  const ready = await waitReady(appServer.url, appServer.startupTimeoutMs);
  if (!ready) {
    throw new Error("Codex desktop app-server did not become ready");
  }
}

export async function ensureCodexAppServerReady(
  config: CodexAppServerConfig,
  onLog: (stream: TaskLogStream, text: string) => void
): Promise<void> {
  return ensureAppServer(config, onLog);
}

function spawnAppServer(command: string, url: string) {
  const spec = buildAppServerSpawnSpec(command, url, process.platform);
  return spawn(spec.command, spec.args, spec.options);
}

export function buildAppServerSpawnSpec(
  command: string,
  url: string,
  platform: NodeJS.Platform = process.platform
): { command: string; args: string[]; options: SpawnOptions } {
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: buildWindowsAppServerStartArgs(command, url),
      options: {
        windowsHide: true,
        stdio: "ignore"
      }
    };
  }
  return {
    command,
    args: ["app-server", "--listen", url],
    options: {
      detached: true,
      windowsHide: true,
      stdio: "ignore"
    }
  };
}

export function buildWindowsAppServerStartArgs(command: string, url: string): string[] {
  const workingDirectory = path.isAbsolute(command) ? path.dirname(command) : process.cwd();
  const script = [
    `Start-Process`,
    `-FilePath ${quotePowerShell(command)}`,
    `-ArgumentList @('app-server','--listen',${quotePowerShell(url)})`,
    `-WorkingDirectory ${quotePowerShell(workingDirectory)}`,
    `-WindowStyle Hidden`
  ].join(" ");
  return ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script];
}

interface RefreshWindowTarget {
  handle?: string;
  processId?: string;
}

export function buildWindowsDesktopRefreshArgs(
  scriptPath: string,
  windowTitlePattern: string,
  target: RefreshWindowTarget = {}
): string[] {
  const args = [
    "-Sta",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.resolve(scriptPath),
    "-WindowTitlePattern",
    windowTitlePattern
  ];
  if (target.processId) {
    args.push("-WindowProcessId", target.processId);
  }
  if (target.handle) {
    args.push("-WindowHandle", target.handle);
  }
  return args;
}

async function refreshDesktopAfterTurn(
  appServer: CodexAppServerConfig,
  task: TaskRecord,
  onLog: (stream: TaskLogStream, text: string) => void
): Promise<void> {
  if (!appServer.refreshDesktopAfterTurn || process.platform !== "win32") {
    return;
  }
  try {
    await runDesktopRefreshScript(appServer, task, onLog);
  } catch (error) {
    onLog("system", `desktop refresh failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

function runDesktopRefreshScript(
  appServer: CodexAppServerConfig,
  task: TaskRecord,
  onLog: (stream: TaskLogStream, text: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const refreshTimeoutMs = appServer.refreshTimeoutMs ?? 8000;
    const child = spawn(
      "powershell.exe",
      buildWindowsDesktopRefreshArgs(
        appServer.refreshScriptPath ?? "scripts/refresh-codex-desktop.ps1",
        appServer.refreshWindowTitlePattern ?? "Codex|OpenAI",
        parseRefreshWindowTarget(task.refreshWindowId)
      ),
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`desktop refresh timed out after ${refreshTimeoutMs}ms`));
    }, refreshTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => onLog("system", chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      onLog("stderr", text);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `desktop refresh script exited with code ${code ?? 1}`));
    });
  });
}

export function parseRefreshWindowTarget(refreshWindowId: string | undefined): RefreshWindowTarget {
  if (!refreshWindowId) {
    return {};
  }
  const parts = refreshWindowId.split(":");
  const last = parts.at(-1)?.trim();
  if (!last) {
    return {};
  }
  if (parts.at(-2) === "pid") {
    return { processId: last };
  }
  return { handle: last };
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function waitReady(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReady(url, 800)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function isReady(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(toReadyUrl(url), { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function isCodexAppServerReady(url: string): Promise<boolean> {
  return isReady(url, 800);
}

function toReadyUrl(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  parsed.pathname = "/readyz";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function connectWebSocket(url: string, signal: AbortSignal, timeoutMs: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Codex app-server connection timed out"));
    }, timeoutMs);
    const abort = () => {
      ws.close();
      reject(new Error("cancelled by request"));
    };
    signal.addEventListener("abort", abort, { once: true });
    ws.once("open", () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(ws);
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

export function resolveCodexAppServerCommand(configuredCommand?: string, localAppData = process.env.LOCALAPPDATA): string {
  if (configuredCommand) {
    return configuredCommand;
  }
  if (!localAppData) {
    return "codex";
  }
  const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
  try {
    const candidates = fs
      .readdirSync(binRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const command = path.join(binRoot, entry.name, "codex.exe");
        try {
          const stat = fs.statSync(command);
          return [{ command, mtimeMs: stat.mtimeMs }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.command ?? "codex";
  } catch {
    return "codex";
  }
}
