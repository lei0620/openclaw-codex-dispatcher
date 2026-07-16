import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CodexDesktopReadState {
  active: boolean;
  readAt: string;
}

interface ViewEvent {
  at: string;
  active: boolean;
  sessionId: string;
  windowId: string;
}

const maxLogFiles = 20;
const maxTailBytes = 2 * 1024 * 1024;
const logAppendOverlapBytes = 64 * 1024;
const maxCachedEventsPerFile = 1000;
const logEventCache = new Map<string, { size: number; events: ViewEvent[] }>();

export function readCodexDesktopReadStates(): Map<string, CodexDesktopReadState> {
  const logRoot = process.env.OPENCLAW_CODEX_DESKTOP_LOG_ROOT || discoverCodexLogRoot();
  if (!logRoot || !fs.existsSync(logRoot)) return new Map();

  const events = listLogFiles(logRoot)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, maxLogFiles)
    .flatMap(readCachedViewEvents)
    .sort((left, right) => left.at.localeCompare(right.at));

  const readAtBySession = new Map<string, string>();
  const activeSessionByWindow = new Map<string, string>();
  for (const event of events) {
    readAtBySession.set(event.sessionId, event.at);
    if (event.active) {
      activeSessionByWindow.set(event.windowId, event.sessionId);
    } else if (activeSessionByWindow.get(event.windowId) === event.sessionId) {
      activeSessionByWindow.delete(event.windowId);
    }
  }

  const activeSessionIds = new Set(activeSessionByWindow.values());
  return new Map(
    [...readAtBySession].map(([sessionId, readAt]) => [sessionId, { active: activeSessionIds.has(sessionId), readAt }])
  );
}

export function parseViewEvents(text: string): ViewEvent[] {
  const events: ViewEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("thread_stream_view_activity_changed")) continue;
    const at = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/)?.[1];
    const active = line.match(/\bactive=(true|false)\b/)?.[1];
    const sessionId = line.match(/\bconversationId=([^\s]+)/)?.[1];
    const windowId = line.match(/\brendererWindowId=([^\s]+)/)?.[1];
    if (!at || !active || !sessionId || !windowId) continue;
    events.push({ at, active: active === "true", sessionId, windowId });
  }
  return events;
}

function discoverCodexLogRoot(): string | undefined {
  const packagesRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Packages");
  if (!fs.existsSync(packagesRoot)) return undefined;
  const packageName = fs.readdirSync(packagesRoot).find((name) => name.startsWith("OpenAI.Codex_"));
  return packageName
    ? path.join(packagesRoot, packageName, "LocalCache", "Local", "Codex", "Logs")
    : undefined;
}

function listLogFiles(root: string): Array<{ fullPath: string; mtimeMs: number }> {
  const files: Array<{ fullPath: string; mtimeMs: number }> = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      if (entry.isFile() && entry.name.endsWith(".log")) {
        files.push({ fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs });
      }
    }
  };
  visit(root);
  return files;
}

function readCachedViewEvents(file: { fullPath: string; mtimeMs: number }): ViewEvent[] {
  const stat = fs.statSync(file.fullPath);
  const cached = logEventCache.get(file.fullPath);
  if (cached && cached.size === stat.size) return cached.events;

  const start = cached && stat.size > cached.size
    ? Math.max(0, cached.size - logAppendOverlapBytes)
    : Math.max(0, stat.size - maxTailBytes);
  const freshEvents = parseViewEvents(readFileRange(file.fullPath, start, stat.size));
  const combined = cached && stat.size > cached.size
    ? deduplicateViewEvents([...cached.events, ...freshEvents])
    : freshEvents;
  const events = combined.slice(-maxCachedEventsPerFile);
  logEventCache.set(file.fullPath, { size: stat.size, events });
  return events;
}

function deduplicateViewEvents(events: ViewEvent[]): ViewEvent[] {
  const unique = new Map<string, ViewEvent>();
  for (const event of events) {
    unique.set(`${event.at}\u0000${event.windowId}\u0000${event.sessionId}\u0000${event.active}`, event);
  }
  return [...unique.values()].sort((left, right) => left.at.localeCompare(right.at));
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
