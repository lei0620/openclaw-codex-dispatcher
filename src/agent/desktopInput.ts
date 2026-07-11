import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { DesktopInputConfig, ProjectConfig, TaskLogStream, TaskRecord, TaskResult } from "../shared/types.js";
import { stripInternalMarkup } from "../shared/textSanitizer.js";

interface SessionReply {
  sessionId?: string;
  text: string;
}

interface DesktopWindowTarget {
  handle?: string;
  processId?: string;
}

export async function runDesktopInputTask(
  config: DesktopInputConfig,
  task: TaskRecord,
  project: ProjectConfig,
  signal: AbortSignal,
  onLog: (stream: TaskLogStream, text: string) => void
): Promise<TaskResult> {
  if (!isWindows()) {
    throw new Error("desktop input simulation is only supported on Windows.");
  }

  const startedAt = Date.now();
  onLog("system", "desktop input: sending prompt to the visible Codex window\n");
  await sendPromptToCodexDesktop(config, task.prompt, task.refreshWindowId, task.codexSessionId, signal, onLog);

  if (signal.aborted) {
    return { exitCode: 1, summary: "Cancelled by request.", diffSummary: "not checked" };
  }

  onLog("system", "desktop input: waiting for the desktop Codex reply\n");
  const reply = await waitForDesktopReply(
    task.prompt,
    startedAt,
    config.responseTimeoutMs,
    signal,
    task.codexSessionId
  );
  if (!reply) {
    return {
      exitCode: 0,
      summary: "已发送到电脑端 Codex 窗口；暂时没有捕获到回复，请在电脑端查看。",
      diffSummary: "not checked"
    };
  }

  onLog("stdout", reply.text);
  return {
    exitCode: 0,
    summary: reply.text,
    diffSummary: "not checked",
    codexSessionId: task.codexSessionId ?? reply.sessionId
  };
}

async function sendPromptToCodexDesktop(
  config: DesktopInputConfig,
  prompt: string,
  refreshWindowId: string | undefined,
  codexSessionId: string | undefined,
  signal: AbortSignal,
  onLog: (stream: TaskLogStream, text: string) => void
): Promise<void> {
  const promptFile = path.join(os.tmpdir(), `openclaw-codex-prompt-${process.pid}-${Date.now()}.txt`);
  await fs.promises.writeFile(promptFile, prompt, "utf8");
  await new Promise<void>((resolve, reject) => {
    const scriptPath = path.resolve(config.scriptPath);
    const child = spawn(
      "powershell.exe",
      buildDesktopInputScriptArgs(scriptPath, promptFile, config, refreshWindowId, codexSessionId),
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    let stderr = "";
    const abort = () => {
      child.kill("SIGTERM");
      reject(new Error("cancelled by request"));
    };
    signal.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => onLog("system", chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      onLog("stderr", text);
    });
    child.on("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `desktop input script exited with code ${code ?? 1}`));
      }
    });

    child.stdin.end();
  }).finally(() => {
    fs.promises.unlink(promptFile).catch(() => undefined);
  });
}

export function buildDesktopInputScriptArgs(
  scriptPath: string,
  promptFile: string,
  config: DesktopInputConfig,
  refreshWindowId?: string,
  codexSessionId?: string
): string[] {
  const args = [
    "-Sta",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-PromptFile",
    promptFile,
    "-ClickYOffset",
    String(config.clickYOffset),
    "-WindowTitlePattern",
    config.windowTitlePattern
  ];
  const target = parseDesktopWindowTarget(refreshWindowId);
  if (target.processId) {
    args.push("-WindowProcessId", target.processId);
  }
  if (target.handle) {
    args.push("-WindowHandle", target.handle);
  }
  if (codexSessionId) {
    args.push("-CodexSessionId", codexSessionId);
  }
  return args;
}

export function parseDesktopWindowTarget(refreshWindowId: string | undefined): DesktopWindowTarget {
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

async function waitForDesktopReply(
  prompt: string,
  startedAt: number,
  timeoutMs: number,
  signal: AbortSignal,
  expectedSessionId?: string
): Promise<SessionReply | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted) {
      return undefined;
    }
    const reply = findReplyAfterPrompt(prompt, startedAt - 2000, expectedSessionId);
    if (reply) {
      return reply;
    }
    await delay(1000, signal);
  }
  return undefined;
}

export function findReplyAfterPrompt(
  prompt: string,
  sinceMs: number,
  expectedSessionId?: string
): SessionReply | undefined {
  const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
  if (!fs.existsSync(root)) {
    return undefined;
  }

  const files = listRecentSessionFiles(root, sinceMs).slice(0, 80);
  for (const file of files) {
    if (expectedSessionId && !sessionFileMatches(file.fullPath, expectedSessionId)) {
      continue;
    }
    const reply = parseSessionReply(file.fullPath, prompt, sinceMs);
    if (reply) {
      return reply;
    }
  }
  return undefined;
}

function sessionFileMatches(filePath: string, expectedSessionId: string): boolean {
  if (sessionIdFromFileName(filePath) === expectedSessionId) {
    return true;
  }
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const item = JSON.parse(line);
      if (item.type === "session_meta" && item.payload?.id === expectedSessionId) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

function listRecentSessionFiles(root: string, sinceMs: number): Array<{ fullPath: string; mtimeMs: number }> {
  const results: Array<{ fullPath: string; mtimeMs: number }> = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue;
      }
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs >= sinceMs) {
        results.push({ fullPath, mtimeMs: stat.mtimeMs });
      }
    }
  }
  return results.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function parseSessionReply(filePath: string, prompt: string, sinceMs: number): SessionReply | undefined {
  let sessionId = sessionIdFromFileName(filePath);
  let sawPrompt = false;
  let latestReply = "";

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const item = JSON.parse(line);
      const timestamp = Date.parse(String(item.timestamp ?? ""));
      if (Number.isFinite(timestamp) && timestamp < sinceMs) {
        continue;
      }
      if (item.type === "session_meta") {
        sessionId = String(item.payload?.id ?? sessionId);
        continue;
      }
      const userText = extractUserText(item);
      if (userText && normalizeText(userText) === normalizeText(prompt)) {
        sawPrompt = true;
        latestReply = "";
        continue;
      }
      if (!sawPrompt) {
        continue;
      }
      const assistantText = extractAssistantText(item);
      if (assistantText) {
        latestReply = assistantText;
      }
    } catch {
      // Codex can append a partial JSON line while it is still writing.
    }
  }

  return latestReply ? { sessionId, text: latestReply } : undefined;
}

function extractUserText(item: Record<string, unknown>): string {
  if (item.type === "event_msg") {
    const payload = item.payload as { type?: unknown; message?: unknown } | undefined;
    if (payload?.type === "user_message" && typeof payload.message === "string") {
      return payload.message.trim();
    }
  }
  if (item.type !== "response_item") {
    return "";
  }
  const payload = item.payload as { type?: unknown; role?: unknown; content?: unknown } | undefined;
  if (payload?.type !== "message" || payload.role !== "user") {
    return "";
  }
  return extractContentText(payload.content, ["input_text", "text"]).trim();
}

function extractAssistantText(item: Record<string, unknown>): string {
  if (item.type === "event_msg") {
    const payload = item.payload as { type?: unknown; message?: unknown; phase?: unknown } | undefined;
    if (payload?.type === "agent_message" && typeof payload.message === "string") {
      if (payload.phase && payload.phase !== "final_answer") {
        return "";
      }
      return stripInternalMarkup(payload.message);
    }
  }
  if (item.type !== "response_item") {
    return "";
  }
  const payload = item.payload as { type?: unknown; role?: unknown; content?: unknown; phase?: unknown } | undefined;
  if (payload?.type !== "message" || payload.role !== "assistant") {
    return "";
  }
  if (payload.phase && payload.phase !== "final_answer") {
    return "";
  }
  return stripInternalMarkup(extractContentText(payload.content, ["output_text", "text"]));
}

function extractContentText(content: unknown, acceptedTypes: string[]): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const record = part as { type?: unknown; text?: unknown };
      if (typeof record.text !== "string") {
        return "";
      }
      if (typeof record.type === "string" && !acceptedTypes.includes(record.type)) {
        return "";
      }
      return record.text;
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function sessionIdFromFileName(filePath: string): string | undefined {
  return path.basename(filePath).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
}

function isWindows(): boolean {
  return process.platform === "win32";
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}
