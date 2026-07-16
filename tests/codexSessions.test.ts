import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { isCodexContextMessage, readRecentCodexConversations, selectRecentConversationMessages } from "../src/agent/codexSessions.js";
import { stripInternalMarkup } from "../src/shared/textSanitizer.js";
import type { ConversationMessage, ProjectConfig } from "../src/shared/types.js";

describe("selectRecentConversationMessages", () => {
  it("keeps the latest user turn even when many assistant progress messages follow", () => {
    const messages: ConversationMessage[] = [
      { role: "user", text: "旧问题", at: "2026-05-31T10:00:00.000Z" },
      { role: "assistant", text: "旧回答", at: "2026-05-31T10:01:00.000Z" },
      { role: "user", text: "手机同步这个问题", at: "2026-05-31T10:02:00.000Z" },
      ...Array.from({ length: 24 }, (_, index) => ({
        role: "assistant" as const,
        text: `处理中 ${index + 1}`,
        at: `2026-05-31T10:${String(index + 3).padStart(2, "0")}:00.000Z`
      }))
    ];

    const selected = selectRecentConversationMessages(messages);

    expect(selected[0]).toMatchObject({ role: "user", text: "手机同步这个问题" });
    expect(selected).toHaveLength(18);
    expect(selected.at(-1)).toMatchObject({ text: "处理中 24" });
  });

  it("keeps the latest three user turns when the conversation is short", () => {
    const messages: ConversationMessage[] = [
      { role: "user", text: "第一轮", at: "2026-05-31T10:00:00.000Z" },
      { role: "assistant", text: "回答一", at: "2026-05-31T10:01:00.000Z" },
      { role: "user", text: "第二轮", at: "2026-05-31T10:02:00.000Z" },
      { role: "assistant", text: "回答二", at: "2026-05-31T10:03:00.000Z" },
      { role: "user", text: "第三轮", at: "2026-05-31T10:04:00.000Z" },
      { role: "assistant", text: "回答三", at: "2026-05-31T10:05:00.000Z" },
      { role: "user", text: "第四轮", at: "2026-05-31T10:06:00.000Z" }
    ];

    expect(selectRecentConversationMessages(messages).map((message) => message.text)).toEqual([
      "第二轮",
      "回答二",
      "第三轮",
      "回答三",
      "第四轮"
    ]);
  });

  it("normalizes newest-first synced messages back to chat order", () => {
    const selected = selectRecentConversationMessages([
      { role: "user", text: "在吗", at: "2026-06-01T14:24:00.000Z" },
      { role: "assistant", text: "在。", at: "2026-06-01T14:24:10.000Z" },
      { role: "user", text: "我成功了", at: "2026-06-01T14:10:00.000Z" },
      { role: "assistant", text: "好的。", at: "2026-06-01T14:10:10.000Z" }
    ]);

    expect(selected.map((message) => message.text)).toEqual(["我成功了", "好的。", "在吗", "在。"]);
  });

  it("filters internal continuation context messages", () => {
    expect(isCodexContextMessage("<goal_context>\nContinue working toward the active thread goal.")).toBe(true);
  });

  it("removes internal memory citation markup from display text", () => {
    expect(
      stripInternalMarkup(`收到了，这次是实时进来的。\n\n<oai-mem-citation>\n<citation_entries>\nMEMORY.md:1-3|note=[x]\n</citation_entries>\n</oai-mem-citation>`)
    ).toBe("收到了，这次是实时进来的。");
  });

  it("removes Codex desktop action directives from synced answers", () => {
    expect(
      stripInternalMarkup(`回答正文。\n\n::git-stage{cwd="D:\\\\aixm\\\\openclaw"}\n::git-commit{cwd="D:\\\\aixm\\\\openclaw"}\n::git-push{cwd="D:\\\\aixm\\\\openclaw" branch="main"}`)
    ).toBe("回答正文。");
  });

  it("syncs the latest five conversations for each project by default", async () => {
    const previousCodexHome = process.env.CODEX_HOME;
    const previousLimit = process.env.OPENCLAW_CODEX_CONVERSATION_LIMIT;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-codex-home-"));
    try {
      process.env.CODEX_HOME = tmp;
      delete process.env.OPENCLAW_CODEX_CONVERSATION_LIMIT;
      const projectPath = path.join(tmp, "project");
      const sessionsDir = path.join(tmp, "sessions", "2026", "07", "12");
      fs.mkdirSync(projectPath, { recursive: true });
      fs.mkdirSync(sessionsDir, { recursive: true });
      for (let index = 1; index <= 6; index += 1) {
        const sessionId = `session-${index}`;
        writeSessionFile(path.join(sessionsDir, `${sessionId}.jsonl`), sessionId, projectPath, [
          { role: "user", text: `对话 ${index}`, at: `2026-07-12T0${index}:00:00.000Z` }
        ]);
      }
      const projects: ProjectConfig[] = [{
        id: "demo", name: "Demo", path: projectPath, defaultMode: "codex", allowedModes: ["codex"], notify: true
      }];
      vi.resetModules();
      const module = await import("../src/agent/codexSessions.js");

      expect(module.readRecentCodexConversations(projects).map((item) => item.sessionId)).toEqual([
        "session-6", "session-5", "session-4", "session-3", "session-2"
      ]);
    } finally {
      restoreEnv("CODEX_HOME", previousCodexHome);
      restoreEnv("OPENCLAW_CODEX_CONVERSATION_LIMIT", previousLimit);
      fs.rmSync(tmp, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("matches desktop recency, title, archive state, and user-thread filtering when the Codex state database is available", () => {
    const previousCodexHome = process.env.CODEX_HOME;
    const previousLimit = process.env.OPENCLAW_CODEX_CONVERSATION_LIMIT;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-codex-home-"));
    try {
      process.env.CODEX_HOME = tmp;
      delete process.env.OPENCLAW_CODEX_CONVERSATION_LIMIT;
      const projectPath = path.join(tmp, "project");
      const sessionsDir = path.join(tmp, "sessions", "2026", "07", "14");
      fs.mkdirSync(projectPath, { recursive: true });
      fs.mkdirSync(sessionsDir, { recursive: true });

      const indexLines: string[] = [];
      for (let index = 1; index <= 8; index += 1) {
        const sessionId = `session-${index}`;
        writeSessionFile(path.join(sessionsDir, `${sessionId}.jsonl`), sessionId, projectPath, [
          { role: "user", text: `对话 ${index}`, at: `2026-07-14T0${index}:00:00.000Z` }
        ]);
        indexLines.push(JSON.stringify({
          id: sessionId,
          thread_name: index === 2 ? "配置飞牛NAS源" : `桌面标题 ${index}`,
          updated_at: index === 2 ? "2026-07-04T09:18:28.000Z" : `2026-07-14T0${index}:00:00.000Z`
        }));
      }
      fs.writeFileSync(path.join(tmp, "session_index.jsonl"), indexLines.join("\n"), "utf8");

      const database = new DatabaseSync(path.join(tmp, "state_5.sqlite"));
      database.exec(`
        CREATE TABLE threads (
          id TEXT PRIMARY KEY,
          cwd TEXT NOT NULL,
          title TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0,
          thread_source TEXT,
          updated_at_ms INTEGER,
          recency_at_ms INTEGER
        )
      `);
      const insert = database.prepare(`
        INSERT INTO threads (id, cwd, title, archived, thread_source, updated_at_ms, recency_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const deviceCwd = `\\\\?\\${projectPath}`;
      const desktopOrder = ["session-1", "session-2", "session-3", "session-4", "session-5", "session-6"];
      desktopOrder.forEach((sessionId, index) => {
        const timestamp = Date.parse(`2026-07-14T${String(12 - index).padStart(2, "0")}:00:00.000Z`);
        insert.run(sessionId, deviceCwd, sessionId, 0, "user", timestamp, timestamp);
      });
      const archivedTimestamp = Date.parse("2026-07-14T13:00:00.000Z");
      insert.run("session-7", deviceCwd, "archived", 1, "user", archivedTimestamp, archivedTimestamp);
      const subagentTimestamp = Date.parse("2026-07-14T14:00:00.000Z");
      insert.run("session-8", deviceCwd, "subagent", 0, "subagent", subagentTimestamp, subagentTimestamp);
      database.close();

      const projects: ProjectConfig[] = [{
        id: "demo", name: "Demo", path: projectPath, defaultMode: "codex", allowedModes: ["codex"], notify: true
      }];

      expect(readRecentCodexConversations(projects).map(({ sessionId, title }) => ({ sessionId, title }))).toEqual([
        { sessionId: "session-1", title: "桌面标题 1" },
        { sessionId: "session-2", title: "配置飞牛NAS源" },
        { sessionId: "session-3", title: "桌面标题 3" },
        { sessionId: "session-4", title: "桌面标题 4" },
        { sessionId: "session-5", title: "桌面标题 5" }
      ]);
    } finally {
      restoreEnv("CODEX_HOME", previousCodexHome);
      restoreEnv("OPENCLAW_CODEX_CONVERSATION_LIMIT", previousLimit);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("syncs recent messages from a large session file without reading the whole file", () => {
    const previousEnv = {
      CODEX_HOME: process.env.CODEX_HOME,
      OPENCLAW_CODEX_SESSION_FULL_READ_MAX_BYTES: process.env.OPENCLAW_CODEX_SESSION_FULL_READ_MAX_BYTES,
      OPENCLAW_CODEX_SESSION_HEAD_BYTES: process.env.OPENCLAW_CODEX_SESSION_HEAD_BYTES,
      OPENCLAW_CODEX_SESSION_TAIL_BYTES: process.env.OPENCLAW_CODEX_SESSION_TAIL_BYTES
    };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-codex-home-"));
    try {
      process.env.CODEX_HOME = tmp;
      process.env.OPENCLAW_CODEX_SESSION_FULL_READ_MAX_BYTES = "200";
      process.env.OPENCLAW_CODEX_SESSION_HEAD_BYTES = "512";
      process.env.OPENCLAW_CODEX_SESSION_TAIL_BYTES = "700";
      const projectPath = path.join(tmp, "project");
      const sessionsDir = path.join(tmp, "sessions", "2026", "06", "30");
      fs.mkdirSync(projectPath, { recursive: true });
      fs.mkdirSync(sessionsDir, { recursive: true });
      const sessionId = "019ea06b-17d8-7a32-8106-334d3ae55286";
      const sessionFile = path.join(sessionsDir, `rollout-2026-06-30T20-00-00-${sessionId}.jsonl`);
      const meta = {
        type: "session_meta",
        payload: {
          id: sessionId,
          cwd: projectPath,
          timestamp: "2026-06-30T12:00:00.000Z"
        }
      };
      const userMessage = {
        type: "response_item",
        timestamp: "2026-06-30T12:01:00.000Z",
        payload: { type: "message", role: "user", content: [{ text: "手机端窗口备注测试" }] }
      };
      const assistantMessage = {
        type: "response_item",
        timestamp: "2026-06-30T12:01:30.000Z",
        payload: { type: "message", role: "assistant", content: [{ text: "备注已收到。" }] }
      };
      fs.writeFileSync(
        sessionFile,
        [
          JSON.stringify(meta),
          "x".repeat(1024),
          JSON.stringify(userMessage),
          JSON.stringify(assistantMessage)
        ].join("\n"),
        "utf8"
      );
      const projects: ProjectConfig[] = [
        {
          id: "demo",
          name: "Demo",
          path: projectPath,
          defaultMode: "codex",
          allowedModes: ["codex"],
          notify: true
        }
      ];

      const conversations = readRecentCodexConversations(projects);

      expect(conversations).toMatchObject([
        {
          projectId: "demo",
          sessionId,
          messages: [
            { role: "user", text: "手机端窗口备注测试" },
            { role: "assistant", text: "备注已收到。" }
          ]
        }
      ]);
    } finally {
      restoreEnv("CODEX_HOME", previousEnv.CODEX_HOME);
      restoreEnv("OPENCLAW_CODEX_SESSION_FULL_READ_MAX_BYTES", previousEnv.OPENCLAW_CODEX_SESSION_FULL_READ_MAX_BYTES);
      restoreEnv("OPENCLAW_CODEX_SESSION_HEAD_BYTES", previousEnv.OPENCLAW_CODEX_SESSION_HEAD_BYTES);
      restoreEnv("OPENCLAW_CODEX_SESSION_TAIL_BYTES", previousEnv.OPENCLAW_CODEX_SESSION_TAIL_BYTES);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("merges multiple rollout files that belong to the same Codex session", () => {
    const previousCodexHome = process.env.CODEX_HOME;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-codex-home-"));
    try {
      process.env.CODEX_HOME = tmp;
      const projectPath = path.join(tmp, "project");
      const sessionsDir = path.join(tmp, "sessions", "2026", "07", "11");
      fs.mkdirSync(projectPath, { recursive: true });
      fs.mkdirSync(sessionsDir, { recursive: true });
      const sessionId = "019f5a2e-8ef8-7e70-9508-b642b03da102";
      writeSessionFile(path.join(sessionsDir, `rollout-a-${sessionId}.jsonl`), sessionId, projectPath, [
        { role: "user", text: "第一条", at: "2026-07-11T08:00:00.000Z" },
        { role: "assistant", text: "回答一", at: "2026-07-11T08:00:10.000Z" }
      ]);
      writeSessionFile(path.join(sessionsDir, `rollout-b-${sessionId}.jsonl`), sessionId, projectPath, [
        { role: "user", text: "第二条", at: "2026-07-11T08:01:00.000Z" },
        { role: "assistant", text: "回答二", at: "2026-07-11T08:01:10.000Z" }
      ]);
      const projects: ProjectConfig[] = [{
        id: "demo",
        name: "Demo",
        path: projectPath,
        defaultMode: "codex",
        allowedModes: ["codex"],
        notify: true
      }];

      const conversations = readRecentCodexConversations(projects);

      expect(conversations).toHaveLength(1);
      expect(conversations[0]).toMatchObject({
        sessionId,
        messages: [
          { role: "user", text: "第一条" },
          { role: "assistant", text: "回答一" },
          { role: "user", text: "第二条" },
          { role: "assistant", text: "回答二" }
        ]
      });
    } finally {
      restoreEnv("CODEX_HOME", previousCodexHome);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("preserves commentary and final-answer phases during desktop conversation sync", () => {
    const previousCodexHome = process.env.CODEX_HOME;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-codex-home-"));
    try {
      process.env.CODEX_HOME = tmp;
      const projectPath = path.join(tmp, "project");
      const sessionsDir = path.join(tmp, "sessions", "2026", "07", "11");
      fs.mkdirSync(projectPath, { recursive: true });
      fs.mkdirSync(sessionsDir, { recursive: true });
      const sessionId = "019f5a2e-8ef8-7e70-9508-b642b03da103";
      const lines = [
        { type: "session_meta", payload: { id: sessionId, cwd: projectPath, timestamp: "2026-07-11T10:00:00.000Z" } },
        { type: "event_msg", timestamp: "2026-07-11T10:00:00.000Z", payload: { type: "task_started" } },
        { type: "response_item", timestamp: "2026-07-11T10:00:00.000Z", payload: { type: "message", role: "user", content: [{ text: "检查" }] } },
        { type: "response_item", timestamp: "2026-07-11T10:00:01.000Z", payload: { type: "message", role: "assistant", phase: "commentary", content: [{ text: "正在检查" }] } },
        { type: "response_item", timestamp: "2026-07-11T10:00:02.000Z", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ text: "检查完成" }] } },
        { type: "event_msg", timestamp: "2026-07-11T10:00:03.000Z", payload: { type: "task_complete" } }
      ];
      fs.writeFileSync(path.join(sessionsDir, `rollout-${sessionId}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n"));
      const projects: ProjectConfig[] = [{
        id: "demo", name: "Demo", path: projectPath, defaultMode: "codex", allowedModes: ["codex"], notify: true
      }];

      const conversation = readRecentCodexConversations(projects)[0];
      expect(conversation.messages).toMatchObject([
        { role: "user", text: "检查" },
        { role: "assistant", phase: "commentary", text: "正在检查" },
        { role: "assistant", phase: "final_answer", text: "检查完成" }
      ]);
      expect(conversation).toMatchObject({
        activityStatus: "completed",
        activityUpdatedAt: "2026-07-11T10:00:03.000Z"
      });
    } finally {
      restoreEnv("CODEX_HOME", previousCodexHome);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

function writeSessionFile(
  filePath: string,
  sessionId: string,
  cwd: string,
  messages: ConversationMessage[]
): void {
  const lines: unknown[] = [{ type: "session_meta", payload: { id: sessionId, cwd, timestamp: messages[0]?.at } }];
  for (const message of messages) {
    lines.push({
      type: "response_item",
      timestamp: message.at,
      payload: { type: "message", role: message.role, content: [{ text: message.text }] }
    });
  }
  fs.writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf8");
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
