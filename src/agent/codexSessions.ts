import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CodexConversationActivityStatus,
  ConversationMessage,
  ProjectConfig,
  SyncedCodexConversation
} from "../shared/types.js";
import { stripInternalMarkup } from "../shared/textSanitizer.js";
import { readCodexDesktopReadStates } from "./codexDesktopReadState.js";

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
  activityStatus?: CodexConversationActivityStatus;
  activityUpdatedAt?: string;
}

interface CodexThreadState {
  sessionId: string;
  cwd: string;
  recencyAt: string;
}

interface SelectedCodexThread extends CodexThreadState {
  projectId: string;
}

interface SessionActivity {
  status: CodexConversationActivityStatus;
  updatedAt: string;
}

const codexConversationLimit = Number(process.env.OPENCLAW_CODEX_CONVERSATION_LIMIT ?? 5);
const maxSessionFiles = Number(process.env.OPENCLAW_CODEX_SESSION_SCAN_MAX ?? 150);
const defaultFullReadMaxBytes = 16 * 1024 * 1024;
const defaultLargeFileHeadBytes = 1024 * 1024;
const defaultLargeFileTailBytes = 8 * 1024 * 1024;
const activityScanChunkBytes = 2 * 1024 * 1024;
const activityScanOverlapBytes = 256 * 1024;
const maxActivityScanBytes = 64 * 1024 * 1024;
const sessionActivityCache = new Map<string, { size: number; activity?: SessionActivity }>();

export function readRecentCodexConversations(projects: ProjectConfig[]): SyncedCodexConversation[] {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const sessionsDir = path.join(codexHome, "sessions");
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  const index = readSessionIndex(path.join(codexHome, "session_index.jsonl"));
  const threadStates = readCodexThreadStates(path.join(codexHome, "state_5.sqlite"));
  const conversations = threadStates
    ? readStateBackedConversations(sessionsDir, index, threadStates, projects)
    : readLegacyConversations(sessionsDir, index, projects);
  const desktopReadStates = readCodexDesktopReadStates();
  return conversations.map((conversation) => {
    const desktop = desktopReadStates.get(conversation.sessionId);
    return desktop
      ? { ...conversation, desktopActive: desktop.active, desktopReadAt: desktop.readAt }
      : conversation;
  });
}

function readLegacyConversations(
  sessionsDir: string,
  index: Map<string, IndexedSession>,
  projects: ProjectConfig[]
): SyncedCodexConversation[] {
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
      messages: parsed.messages,
      activityStatus: parsed.activityStatus,
      activityUpdatedAt: parsed.activityUpdatedAt
    });
    perProject.set(project.id, list);
  }

  return [...perProject.values()]
    .flat()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function readStateBackedConversations(
  sessionsDir: string,
  index: Map<string, IndexedSession>,
  threadStates: CodexThreadState[],
  projects: ProjectConfig[]
): SyncedCodexConversation[] {
  const selected = selectRecentThreadStates(threadStates, projects);
  const selectedById = new Map(selected.map((thread) => [thread.sessionId, thread]));
  const files = listSessionFiles(sessionsDir, new Set(selectedById.keys()));
  const sessionsById = new Map<string, ParsedSession>();

  for (const file of files) {
    const parsed = parseSessionFile(file.fullPath, index);
    if (!parsed) {
      continue;
    }
    const thread = selectedById.get(parsed.sessionId);
    if (!thread) {
      continue;
    }
    const stateBacked: ParsedSession = {
      ...parsed,
      cwd: thread.cwd,
      updatedAt: thread.recencyAt
    };
    const existing = sessionsById.get(parsed.sessionId);
    sessionsById.set(parsed.sessionId, existing ? mergeParsedSessions(existing, stateBacked) : stateBacked);
  }

  return selected
    .map((thread): SyncedCodexConversation | undefined => {
      const parsed = sessionsById.get(thread.sessionId);
      if (!parsed) {
        return undefined;
      }
      return {
        projectId: thread.projectId,
        sessionId: thread.sessionId,
        title: parsed.title || "Codex 对话",
        updatedAt: thread.recencyAt,
        messages: parsed.messages,
        activityStatus: parsed.activityStatus,
        activityUpdatedAt: parsed.activityUpdatedAt
      };
    })
    .filter((conversation): conversation is SyncedCodexConversation => Boolean(conversation))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function readCodexThreadStates(databasePath: string): CodexThreadState[] | undefined {
  if (!fs.existsSync(databasePath)) {
    return undefined;
  }

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database.prepare(`
      SELECT id, cwd, COALESCE(NULLIF(recency_at_ms, 0), updated_at_ms) AS recency_at_ms
      FROM threads
      WHERE archived = 0
        AND COALESCE(thread_source, 'user') <> 'subagent'
    `).all() as Array<Record<string, unknown>>;
    return rows.flatMap((row) => {
      const sessionId = typeof row.id === "string" ? row.id : "";
      const cwd = typeof row.cwd === "string" ? row.cwd : "";
      const recencyAtMs = Number(row.recency_at_ms);
      if (!sessionId || !cwd || !Number.isFinite(recencyAtMs) || recencyAtMs <= 0) {
        return [];
      }
      return [{ sessionId, cwd, recencyAt: new Date(recencyAtMs).toISOString() }];
    });
  } catch {
    return undefined;
  } finally {
    database?.close();
  }
}

function selectRecentThreadStates(
  threadStates: CodexThreadState[],
  projects: ProjectConfig[]
): SelectedCodexThread[] {
  const perProject = new Map<string, SelectedCodexThread[]>();
  for (const thread of [...threadStates].sort((a, b) => b.recencyAt.localeCompare(a.recencyAt))) {
    const project = findProjectForCwd(thread.cwd, projects);
    if (!project) {
      continue;
    }
    const selected = perProject.get(project.id) ?? [];
    if (selected.length >= codexConversationLimit) {
      continue;
    }
    selected.push({ ...thread, projectId: project.id });
    perProject.set(project.id, selected);
  }
  return [...perProject.values()]
    .flat()
    .sort((a, b) => b.recencyAt.localeCompare(a.recencyAt));
}

function mergeParsedSessions(existing: ParsedSession, incoming: ParsedSession): ParsedSession {
  const latestActivity = [existing, incoming]
    .filter((session) => session.activityUpdatedAt)
    .sort((left, right) => String(right.activityUpdatedAt).localeCompare(String(left.activityUpdatedAt)))[0];
  return {
    sessionId: existing.sessionId,
    cwd: existing.cwd || incoming.cwd,
    title: existing.title || incoming.title,
    updatedAt: existing.updatedAt.localeCompare(incoming.updatedAt) >= 0 ? existing.updatedAt : incoming.updatedAt,
    messages: selectRecentConversationMessages(mergeConversationMessages(existing.messages, incoming.messages)),
    activityStatus: latestActivity?.activityStatus,
    activityUpdatedAt: latestActivity?.activityUpdatedAt
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

function listSessionFiles(root: string, selectedSessionIds?: Set<string>): Array<{ fullPath: string; mtimeMs: number }> {
  const results: Array<{ fullPath: string; mtimeMs: number }> = [];
  const stack = [root];
  const normalizedSelectedIds = selectedSessionIds
    ? [...selectedSessionIds].map((sessionId) => sessionId.toLowerCase())
    : undefined;
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        if (normalizedSelectedIds && !normalizedSelectedIds.some((sessionId) => entry.name.toLowerCase().includes(sessionId))) {
          continue;
        }
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
  let activityStatus: CodexConversationActivityStatus | undefined;
  let activityUpdatedAt: string | undefined;

  for (const line of readSessionFileForConversationSync(filePath).split(/\r?\n/)) {
    if (
      !line.includes('"session_meta"')
      && !line.includes('"role":"user"')
      && !line.includes('"role":"assistant"')
      && !line.includes('"type":"task_started"')
      && !line.includes('"type":"task_complete"')
      && !line.includes('"type":"turn_aborted"')
    ) {
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
      if (item.type === "event_msg") {
        const eventType = String(item.payload?.type ?? "");
        if (["task_started", "task_complete", "turn_aborted"].includes(eventType)) {
          activityUpdatedAt = String(item.timestamp ?? fallbackTimestamp);
          fallbackTimestamp = activityUpdatedAt;
          activityStatus = eventType === "task_started"
            ? "running"
            : eventType === "task_complete"
              ? "completed"
              : "idle";
        }
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
  const latestActivity = readLatestSessionActivity(filePath);
  return {
    sessionId,
    cwd,
    title: indexed?.thread_name || firstUserMessage,
    updatedAt: indexed?.updated_at ?? fallbackTimestamp,
    messages: selectRecentConversationMessages(messages),
    activityStatus: latestActivity?.status ?? activityStatus,
    activityUpdatedAt: latestActivity?.updatedAt ?? activityUpdatedAt
  };
}

function readLatestSessionActivity(filePath: string): SessionActivity | undefined {
  const stat = fs.statSync(filePath);
  const cached = sessionActivityCache.get(filePath);
  if (cached && stat.size === cached.size) return cached.activity;

  if (cached && stat.size > cached.size) {
    const appendedStart = Math.max(0, cached.size - activityScanOverlapBytes);
    const appended = readFileRange(filePath, appendedStart, stat.size);
    const activity = findLatestSessionActivity(appended) ?? cached.activity;
    sessionActivityCache.set(filePath, { size: stat.size, activity });
    return activity;
  }

  let end = stat.size;
  let scanned = 0;
  while (end > 0 && scanned < maxActivityScanBytes) {
    const start = Math.max(0, end - activityScanChunkBytes);
    const activity = findLatestSessionActivity(readFileRange(filePath, start, end));
    if (activity) {
      sessionActivityCache.set(filePath, { size: stat.size, activity });
      return activity;
    }
    if (start === 0) break;
    scanned += end - start;
    end = start + activityScanOverlapBytes;
  }

  sessionActivityCache.set(filePath, { size: stat.size });
  return undefined;
}

function findLatestSessionActivity(text: string): SessionActivity | undefined {
  const events: SessionActivity[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (
      !line.includes('"type":"task_started"')
      && !line.includes('"type":"task_complete"')
      && !line.includes('"type":"turn_aborted"')
    ) {
      continue;
    }
    try {
      const item = JSON.parse(line);
      if (item.type !== "event_msg") continue;
      const eventType = String(item.payload?.type ?? "");
      const status: CodexConversationActivityStatus = eventType === "task_started"
        ? "running"
        : eventType === "task_complete"
          ? "completed"
          : "idle";
      events.push({ status, updatedAt: String(item.timestamp ?? "") });
    } catch {
      // Reverse chunks can begin or end in the middle of a JSONL record.
    }
  }
  return events.filter((event) => event.updatedAt).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function readFileRange(filePath: string, start: number, end: number): string {
  const length = Math.max(0, end - start);
  const buffer = Buffer.alloc(length);
  const handle = fs.openSync(filePath, "r");
  try {
    fs.readSync(handle, buffer, 0, length, start);
  } finally {
    fs.closeSync(handle);
  }
  return buffer.toString("utf8");
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
  const withoutDevicePrefix = value.replace(/^\\\\\?\\/, "");
  return path.resolve(withoutDevicePrefix).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}
