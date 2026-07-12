import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConversationMessage, ProjectConfig, SyncedCodexConversation } from "../shared/types.js";
import { stripInternalMarkup } from "../shared/textSanitizer.js";

interface IndexedSession {
  id: string;
  thread_name?: string;
  updated_at?: string;
}

interface ParsedSession {
  sessionId: string;
  cwd?: string;
  title?: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

const codexConversationLimit = Number(process.env.OPENCLAW_CODEX_CONVERSATION_LIMIT ?? 5);
const maxSessionFiles = Number(process.env.OPENCLAW_CODEX_SESSION_SCAN_MAX ?? 150);
const defaultFullReadMaxBytes = 16 * 1024 * 1024;
const defaultLargeFileHeadBytes = 1024 * 1024;
const defaultLargeFileTailBytes = 8 * 1024 * 1024;

export function readRecentCodexConversations(projects: ProjectConfig[]): SyncedCodexConversation[] {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const sessionsDir = path.join(codexHome, "sessions");
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  const index = readSessionIndex(path.join(codexHome, "session_index.jsonl"));
  const files = listSessionFiles(sessionsDir)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxSessionFiles);

  const sessionsById = new Map<string, ParsedSession>();
  for (const file of files) {
    const parsed = parseSessionFile(file.fullPath, index);
    if (!parsed?.cwd) {
      continue;
    }
    const existing = sessionsById.get(parsed.sessionId);
    sessionsById.set(parsed.sessionId, existing ? mergeParsedSessions(existing, parsed) : parsed);
  }

  const perProject = new Map<string, SyncedCodexConversation[]>();
  const sessions = [...sessionsById.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const parsed of sessions) {
    if (!parsed.cwd) {
      continue;
    }
    const project = findProjectForCwd(parsed.cwd, projects);
    if (!project) {
      continue;
    }
    const list = perProject.get(project.id) ?? [];
    if (list.length >= codexConversationLimit) {
      continue;
    }
    list.push({
      projectId: project.id,
      sessionId: parsed.sessionId,
      title: parsed.title || "Codex 对话",
      updatedAt: parsed.updatedAt,
      messages: parsed.messages
    });
    perProject.set(project.id, list);
  }

  return [...perProject.values()]
    .flat()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function mergeParsedSessions(existing: ParsedSession, incoming: ParsedSession): ParsedSession {
  return {
    sessionId: existing.sessionId,
    cwd: existing.cwd || incoming.cwd,
    title: existing.title || incoming.title,
    updatedAt: existing.updatedAt.localeCompare(incoming.updatedAt) >= 0 ? existing.updatedAt : incoming.updatedAt,
    messages: selectRecentConversationMessages(mergeConversationMessages(existing.messages, incoming.messages))
  };
}

function mergeConversationMessages(current: ConversationMessage[], incoming: ConversationMessage[]): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  const keys = new Set<string>();
  for (const message of [...current, ...incoming].sort(compareConversationMessages)) {
    const key = `${message.role}\u0000${message.phase ?? ""}\u0000${message.at}\u0000${message.text}`;
    if (keys.has(key)) {
      continue;
    }
    keys.add(key);
    messages.push(message);
  }
  return messages;
}

function readSessionIndex(indexPath: string): Map<string, IndexedSession> {
  const sessions = new Map<string, IndexedSession>();
  if (!fs.existsSync(indexPath)) {
    return sessions;
  }
  for (const line of fs.readFileSync(indexPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const item = JSON.parse(line) as IndexedSession;
      if (item.id) {
        sessions.set(item.id, item);
      }
    } catch {
      // Ignore partially written index lines.
    }
  }
  return sessions;
}

function listSessionFiles(root: string): Array<{ fullPath: string; mtimeMs: number }> {
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
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push({ fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs });
      }
    }
  }
  return results;
}

function parseSessionFile(filePath: string, index: Map<string, IndexedSession>): ParsedSession | undefined {
  const messages: ConversationMessage[] = [];
  let sessionId = "";
  let cwd = "";
  let fallbackTimestamp = fs.statSync(filePath).mtime.toISOString();

  for (const line of readSessionFileForConversationSync(filePath).split(/\r?\n/)) {
    if (!line.includes('"session_meta"') && !line.includes('"role":"user"') && !line.includes('"role":"assistant"')) {
      continue;
    }
    try {
      const item = JSON.parse(line);
      if (item.type === "session_meta") {
        sessionId = String(item.payload?.id ?? sessionId);
        cwd = String(item.payload?.cwd ?? cwd);
        fallbackTimestamp = String(item.payload?.timestamp ?? fallbackTimestamp);
        continue;
      }
      if (item.type === "response_item" && item.payload?.type === "message") {
        const role = item.payload.role;
        if (role !== "user" && role !== "assistant") {
          continue;
        }
        fallbackTimestamp = String(item.timestamp ?? fallbackTimestamp);
        const text = extractMessageText(item.payload.content);
        if (text && !isCodexContextMessage(text)) {
          messages.push({
            role,
            text: trimMessage(text),
            at: fallbackTimestamp,
            ...(role === "assistant" && (item.payload.phase === "commentary" || item.payload.phase === "final_answer")
              ? { phase: item.payload.phase }
              : {})
          });
        }
      }
    } catch {
      // Session jsonl can contain incomplete trailing writes while Codex is running.
    }
  }

  if (!sessionId) {
    sessionId = sessionIdFromFileName(filePath);
  }
  if (!sessionId) {
    return undefined;
  }

  const indexed = index.get(sessionId);
  const firstUserMessage = messages.find((message) => message.role === "user")?.text;
  return {
    sessionId,
    cwd,
    title: indexed?.thread_name || firstUserMessage,
    updatedAt: indexed?.updated_at ?? fallbackTimestamp,
    messages: selectRecentConversationMessages(messages)
  };
}

function readSessionFileForConversationSync(filePath: string): string {
  const stat = fs.statSync(filePath);
  const maxFullReadBytes = readPositiveIntEnv("OPENCLAW_CODEX_SESSION_FULL_READ_MAX_BYTES", defaultFullReadMaxBytes);
  if (stat.size <= maxFullReadBytes) {
    return fs.readFileSync(filePath, "utf8");
  }

  const headBytes = Math.min(
    readPositiveIntEnv("OPENCLAW_CODEX_SESSION_HEAD_BYTES", defaultLargeFileHeadBytes),
    stat.size
  );
  const tailBytes = Math.min(
    readPositiveIntEnv("OPENCLAW_CODEX_SESSION_TAIL_BYTES", defaultLargeFileTailBytes),
    Math.max(0, stat.size - headBytes)
  );
  const fd = fs.openSync(filePath, "r");
  try {
    const head = Buffer.alloc(headBytes);
    fs.readSync(fd, head, 0, headBytes, 0);
    if (tailBytes <= 0) {
      return head.toString("utf8");
    }
    const tail = Buffer.alloc(tailBytes);
    fs.readSync(fd, tail, 0, tailBytes, stat.size - tailBytes);
    return `${head.toString("utf8")}\n${tail.toString("utf8")}`;
  } finally {
    fs.closeSync(fd);
  }
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function selectRecentConversationMessages(messages: ConversationMessage[]): ConversationMessage[] {
  const chronological = [...messages].sort(compareConversationMessages);
  const userIndexes = chronological
    .map((message, index) => (message.role === "user" ? index : -1))
    .filter((index) => index >= 0);
  if (userIndexes.length === 0) {
    return chronological.slice(-6);
  }

  const start = userIndexes[Math.max(0, userIndexes.length - 3)];
  const recentTurn = chronological.slice(start);
  if (recentTurn.length <= 18) {
    return recentTurn;
  }

  const latestUserIndex = recentTurn.map((message, index) => (message.role === "user" ? index : -1)).filter((index) => index >= 0).at(-1) ?? 0;
  const tail = recentTurn.slice(-18);
  if (tail.some((message, index) => recentTurn.length - tail.length + index === latestUserIndex)) {
    return tail;
  }

  return [recentTurn[latestUserIndex], ...recentTurn.slice(-17)];
}

function compareConversationMessages(left: ConversationMessage, right: ConversationMessage): number {
  const leftTime = Date.parse(left.at || "");
  const rightTime = Date.parse(right.at || "");
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return 0;
}

function extractMessageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const record = part as { text?: unknown };
      return typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function trimMessage(text: string): string {
  const normalized = stripInternalMarkup(text);
  return normalized.length > 800 ? `${normalized.slice(0, 800)}...` : normalized;
}

export function isCodexContextMessage(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("# AGENTS.md instructions") ||
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<goal_context>") ||
    (trimmed.includes("<environment_context>") && trimmed.includes("<INSTRUCTIONS>"))
  );
}

function sessionIdFromFileName(filePath: string): string {
  const match = path.basename(filePath).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match?.[1] ?? "";
}

function findProjectForCwd(cwd: string, projects: ProjectConfig[]): ProjectConfig | undefined {
  const normalizedCwd = normalizePath(cwd);
  return projects.find((project) => {
    const root = normalizePath(project.path);
    return normalizedCwd === root || normalizedCwd.startsWith(`${root}/`);
  });
}

function normalizePath(value: string): string {
  return path.resolve(value).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}
