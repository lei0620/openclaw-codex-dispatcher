import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { groupConversationMessages } from "../public/conversationPresentation.js";

describe("mobile panel timeline", () => {
  it("hides Codex desktop action directives from phone answer text", () => {
    const sanitizeDisplayText = loadStandaloneFunction<(value: unknown) => string>("sanitizeDisplayText");

    expect(
      sanitizeDisplayText(`回答正文。\n\n::git-stage{cwd="D:\\\\aixm\\\\openclaw"}\n::git-commit{cwd="D:\\\\aixm\\\\openclaw"}\n::git-push{cwd="D:\\\\aixm\\\\openclaw" branch="main"}`)
    ).toBe("回答正文。");
  });

  it("does not duplicate a phone prompt that already appears in synced Codex history", () => {
    const renderTimeline = loadRenderTimeline();

    const html = renderTimeline(
      [{ role: "user", text: "在吗", at: "2026-06-30T12:00:00.000Z" }],
      [
        {
          id: "task-1",
          prompt: "在吗",
          status: "running",
          createdAt: "2026-06-30T12:00:01.000Z",
          updatedAt: "2026-06-30T12:00:02.000Z"
        }
      ],
      ""
    );

    expect(html.match(/在吗/g)).toHaveLength(1);
    expect(html).toContain("codex-message");
  });

  it("collapses transient duplicate synced user messages while Codex is still replying", () => {
    const renderTimeline = loadRenderTimeline();

    const html = renderTimeline(
      [
        { role: "user", text: "手机重复测试", at: "2026-06-30T12:00:00.000Z" },
        { role: "user", text: "手机重复测试", at: "2026-06-30T12:00:01.000Z" }
      ],
      [],
      ""
    );

    expect(html.match(/手机重复测试/g)).toHaveLength(1);
  });

  it("keeps a repeated new phone prompt when an older desktop turn has the same text", () => {
    const renderTimeline = loadRenderTimeline();

    const html = renderTimeline(
      [
        { role: "user", text: "在吗", at: "2026-06-30T12:00:00.000Z" },
        { role: "assistant", text: "在的。", at: "2026-06-30T12:00:01.000Z" }
      ],
      [
        {
          id: "task-old",
          prompt: "在吗",
          status: "completed",
          createdAt: "2026-06-30T12:00:00.000Z",
          finishedAt: "2026-06-30T12:00:01.000Z"
        },
        {
          id: "task-new",
          prompt: "在吗",
          status: "running",
          createdAt: "2026-06-30T12:05:00.000Z",
          updatedAt: "2026-06-30T12:05:01.000Z"
        }
      ],
      ""
    );

    expect(html.match(/在吗/g)).toHaveLength(2);
    expect(html.match(/codex-message/g)).toHaveLength(2);
  });
});

function loadRenderTimeline(): (historyMessages: unknown[], tasks: unknown[], prefixHtml: string) => string {
  const source = fs.readFileSync("public/app.js", "utf8");
  const functionNames = [
    "renderTimeline",
    "compareTimelineItems",
    "renderHistoryMessage",
    "renderHistoryProcess",
    "renderProcessDetails",
    "renderUserMessage",
    "isTaskPromptInHistory",
    "normalizeComparableMessageText",
    "matchTasksToHistory",
    "isFinalAssistantMessage",
    "isActiveTimelineTask",
    "dedupeTimelineHistoryMessages",
    "isLikelyDuplicateHistoryMessage",
    "timeDistanceMs"
  ];
  const code = functionNames.map((name) => extractFunction(source, name)).join("\n");
  const sandbox = {
    groupConversationMessages,
    escapeHtml: (value: unknown) => String(value ?? ""),
    sanitizeDisplayText: (value: unknown) => String(value ?? ""),
    renderCodexMessage: () => '<article class="message codex-message"></article>',
    renderTimeline: undefined as unknown
  };
  vm.runInNewContext(`${code}\nthis.renderTimeline = renderTimeline;`, sandbox);
  return sandbox.renderTimeline as (historyMessages: unknown[], tasks: unknown[], prefixHtml: string) => string;
}

function loadStandaloneFunction<T>(name: string): T {
  const source = fs.readFileSync("public/app.js", "utf8");
  const sandbox = { result: undefined as unknown };
  vm.runInNewContext(`${extractFunction(source, name)}\nthis.result = ${name};`, sandbox);
  return sandbox.result as T;
}

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) {
    throw new Error(`function not found: ${name}`);
  }
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`function body not closed: ${name}`);
}
