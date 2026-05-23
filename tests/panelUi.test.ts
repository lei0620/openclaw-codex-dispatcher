import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("mobile panel copy", () => {
  it("uses chat-first Chinese labels instead of developer console labels", () => {
    const html = fs.readFileSync("public/index.html", "utf8");
    const js = fs.readFileSync("public/app.js", "utf8");

    expect(html).toContain("像和 Codex 聊天一样发任务");
    expect(html).toContain("我的 Win11 电脑");
    expect(html).toContain("chat-form");
    expect(js).toContain("只测试连接");
    expect(js).toContain("正式让 Codex 执行");
    expect(js).toContain("排队中");
  });

  it("hides noisy Codex internals behind a technical log disclosure", () => {
    const js = fs.readFileSync("public/app.js", "utf8");

    expect(js).toContain("查看技术日志");
    expect(js).toContain("WARN codex_core_skills::loader");
    expect(js).toContain("tokens used");
  });

  it("supports switching conversations from a project sidebar", () => {
    const html = fs.readFileSync("public/index.html", "utf8");
    const js = fs.readFileSync("public/app.js", "utf8");

    expect(html).toContain("conversation-sidebar");
    expect(html).toContain("conversation-list");
    expect(html).toContain("new-conversation");
    expect(html).toContain("sidebar-toggle");
    expect(js).toContain("/api/conversations");
    expect(js).toContain("/api/conversations/${state.activeConversationId}/tasks");
    expect(js).toContain("activeConversationId");
    expect(js).toContain("data-conversation-id");
  });

  it("separates Codex answers from task status details", () => {
    const js = fs.readFileSync("public/app.js", "utf8");
    const css = fs.readFileSync("public/styles.css", "utf8");

    expect(js).toContain("getAnswerText");
    expect(js).toContain("task-status-line");
    expect(js).toContain("task-details");
    expect(js).toContain("任务详情");
    expect(js).not.toContain("<p>${escapeHtml(describeTask(task))}</p>");
    expect(css).toContain(".answer-text");
    expect(css).toContain(".task-status-line");
    expect(css).toContain(".task-details");
  });
});
