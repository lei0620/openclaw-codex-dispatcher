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
    expect(js).toContain("/api/conversations/${requestedConversationId}/tasks");
    expect(js).toContain("activeConversationId");
    expect(js).toContain("data-conversation-id");
  });

  it("uses a fixed Codex brand and generated icons for every topbar control", () => {
    const html = fs.readFileSync("public/index.html", "utf8");
    const js = fs.readFileSync("public/app.js", "utf8");
    const css = fs.readFileSync("public/styles.css", "utf8");

    expect(html).toContain('<h2 id="current-project-name">Codex</h2>');
    for (const name of ["menu", "window", "device", "sync", "approval", "settings"]) {
      expect(html).toContain(`src="/icons/${name}.png"`);
    }
    expect(js).toContain('els.currentProjectName.textContent = "Codex"');
    expect(css).toContain(".topbar-icon");
    expect(css).toContain("--control-accent: #16846b");
  });

  it("prioritizes running conversations and three recent projects in the sidebar", () => {
    const js = fs.readFileSync("public/app.js", "utf8");
    const css = fs.readFileSync("public/styles.css", "utf8");

    expect(js).toContain('from "/sidebarPriority.js"');
    expect(js).toContain("deriveRunningConversations");
    expect(js).toContain("deriveRecentProjects(state.projects, state.conversations, 3)");
    expect(js).toContain('data-sidebar-section="${section}"');
    expect(js).toContain('renderSidebarSection("running", "正在执行"');
    expect(js).toContain('renderSidebarSection("recent", "最近使用"');
    expect(js).toContain('renderSidebarSection("all", "全部项目"');
    expect(css).toContain(".sidebar-section-title");
    expect(css).toContain(".sidebar-running-item");
    expect(css).toContain(".sidebar-recent-item");
  });

  it("shows active running conversations near the chat top for quick switching", () => {
    const html = fs.readFileSync("public/index.html", "utf8");
    const js = fs.readFileSync("public/app.js", "utf8");
    const css = fs.readFileSync("public/styles.css", "utf8");

    expect(html).toContain("active-sessions");
    expect(js).toContain("renderActiveSessions");
    expect(js).toContain("switchActiveTaskConversation");
    expect(js).toContain("waiting_approval");
    expect(css).toContain(".active-sessions");
    expect(css).toContain(".active-session-card");
    expect(css).toMatch(/\.workspace\s*\{[^}]*display: flex;[^}]*flex-direction: column;/);
    expect(css).toMatch(/\.chat-panel\s*\{[^}]*flex: 1 1 auto;/);
    expect(css).toMatch(/@media \(max-width: 860px\)[\s\S]*?\.workspace\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);/);
    expect(css).toMatch(/@media \(max-width: 860px\)[\s\S]*?\.active-sessions:not\(\[hidden\]\)\s*\{[\s\S]*?grid-row: 1;/);
    expect(css).toMatch(/@media \(max-width: 860px\)[\s\S]*?\.chat-panel\s*\{[\s\S]*?grid-row: 2;/);
  });

  it("lets users add readable remarks to Codex desktop windows", () => {
    const js = fs.readFileSync("public/app.js", "utf8");
    const css = fs.readFileSync("public/styles.css", "utf8");

    expect(js).toContain("/api/codex-windows/remark");
    expect(js).toContain("给这个 Codex 窗口写个备注");
    expect(js).toContain("window-picker-subtitle");
    expect(js).toContain("renameCodexWindow");
    expect(css).toContain(".window-picker-subtitle");
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

  it("folds desktop commentary under the final Codex answer", () => {
    const js = fs.readFileSync("public/app.js", "utf8");
    const css = fs.readFileSync("public/styles.css", "utf8");

    expect(js).toContain('from "/conversationPresentation.js"');
    expect(js).toContain("groupConversationMessages");
    expect(js).toContain("renderProcessDetails");
    expect(js).toContain('completed ? "已处理" : "正在处理"');
    expect(css).toContain(".process-details");
    expect(css).toContain(".process-content");
  });

  it("renders phone user messages as compact desktop-style grey bubbles", () => {
    const css = fs.readFileSync("public/styles.css", "utf8");

    expect(css).toContain(".user-message .bubble");
    expect(css).toContain("background: #f4f4f5");
    expect(css).toContain("width: fit-content");
    expect(css).toContain("max-width: min(88%, 720px)");
    expect(css).toContain("border-radius: 18px");
  });

  it("cache-busts panel assets so mobile WebView loads the latest fixes", () => {
    const html = fs.readFileSync("public/index.html", "utf8");

    expect(html).toContain('/styles.css?v=');
    expect(html).toContain('/app.js?v=');
  });

  it("shows a clear send error when a conversation needs a window binding", () => {
    const html = fs.readFileSync("public/index.html", "utf8");
    const js = fs.readFileSync("public/app.js", "utf8");
    const css = fs.readFileSync("public/styles.css", "utf8");

    expect(html).toContain("submit-error");
    expect(js).toContain("setSubmitError");
    expect(js).toContain("先给这个对话绑定一个电脑窗口");
    expect(css).toContain(".submit-error");
  });

  it("shows separate NAS, computer, and Codex connection details", () => {
    const html = fs.readFileSync("public/index.html", "utf8");
    const js = fs.readFileSync("public/app.js", "utf8");

    expect(html).toContain("connection-details");
    expect(html).toContain("NAS");
    expect(html).toContain("电脑");
    expect(html).toContain("Codex");
    expect(js).toContain("deriveConnectionStatus");
    expect(js).not.toContain('return "离线"');
  });

  it("disables Capacitor bridge logging so request credentials are not written to logcat", () => {
    const config = fs.readFileSync("capacitor.config.ts", "utf8");

    expect(config).toContain('loggingBehavior: "none"');
  });

  it("uses realtime NAS events with a slow reconciliation fallback", () => {
    const js = fs.readFileSync("public/app.js", "utf8");

    expect(js).toContain('createRealtimeClient');
    expect(js).toContain('applyMobileEvent');
    expect(js).toContain('clientMessageId');
    expect(js).toContain('retryPendingSend');
    expect(js).toContain('setInterval(() => refresh(), 30000)');
    expect(js).not.toContain('setInterval(() => refresh(), 2000)');
  });

  it("tracks each submitted task directly until the phone sees its final status", () => {
    const js = fs.readFileSync("public/app.js", "utf8");

    expect(js).toContain('from "/taskStatusWatcher.js"');
    expect(js).toContain("createTaskStatusWatcher");
    expect(js).toContain("taskStatusWatcher.watch(payload.task.id)");
    expect(js).toContain("/api/tasks/${encodeURIComponent(taskId)}");
  });

  it("batches streamed logs without delaying important realtime state changes", () => {
    const js = fs.readFileSync("public/app.js", "utf8");

    expect(js).toContain("realtimeLogRender.schedule()");
    expect(js).toContain("realtimeLogRender.cancel()");
    expect(js).toContain('if (event.type === "task.log")');
  });

  it("recovers after foreground resume without resending a task", () => {
    const js = fs.readFileSync("public/app.js", "utf8");

    expect(js).toContain('createLifecycleRecovery');
    expect(js).toContain('lifecycleRecovery.start()');
    expect(js).toContain('restartRealtime: () => realtime.restart()');
  });

  it("shows a jump-to-latest control without forcing history readers to the bottom", () => {
    const html = fs.readFileSync("public/index.html", "utf8");
    const js = fs.readFileSync("public/app.js", "utf8");
    const css = fs.readFileSync("public/styles.css", "utf8");

    expect(html).toContain('id="jump-to-latest"');
    expect(js).toContain('markActiveConversationUnread');
    expect(js).toContain('clearActiveConversationUnread');
    expect(css).toContain('.jump-to-latest');
  });

  it("shows conversation state markers and a non-technical diagnostics section", () => {
    const html = fs.readFileSync("public/index.html", "utf8");
    const js = fs.readFileSync("public/app.js", "utf8");
    const css = fs.readFileSync("public/styles.css", "utf8");

    expect(html).toContain('id="diagnostics-summary"');
    expect(html).toContain('id="export-diagnostics"');
    expect(js).toContain('buildDiagnosticsSnapshot');
    expect(js).toContain('formatSanitizedDiagnostics');
    expect(js).toContain('getConversationStatusMarker');
    expect(css).toContain('.conversation-status-marker');
    expect(css).toContain('.diagnostics-grid');
  });

  it("keeps automatic latest-conversation following opt-in", () => {
    const html = fs.readFileSync("public/index.html", "utf8");
    const js = fs.readFileSync("public/app.js", "utf8");

    expect(html).toContain('id="auto-follow-conversation" type="checkbox"');
    expect(html).not.toContain('id="auto-follow-conversation" type="checkbox" checked');
    expect(js).toContain('localStorage.getItem(selectionKeys.autoFollowConversation) === "1"');
  });

  it("falls back between the trusted LAN and VPN routes without retrying unsafe posts", () => {
    const js = fs.readFileSync("public/app.js", "utf8");

    expect(js).toContain('const vpnApiBase = "http://100.69.253.5:1314"');
    expect(js).toContain("buildApiBaseCandidates(apiBase, [lanApiBase, vpnApiBase])");
    expect(js).toContain("getApiBases: () => buildApiBaseCandidates(apiBase, [lanApiBase, vpnApiBase])");
    expect(js).toContain("isFailoverSafeRequest(url, options)");
    expect(js).toContain("rememberWorkingApiBase(candidate)");
    expect(js).not.toContain('value === "http://100.69.253.5:1314" ||');
  });

  it("uses a short refresh safety net only while realtime is offline", () => {
    const js = fs.readFileSync("public/app.js", "utf8");

    expect(js).toContain('if (state.realtimeState !== "online")');
    expect(js).toContain('}, 5000);');
    expect(js).toContain('setInterval(() => refresh(), 30000)');
  });

  it("loads Android connection credentials from Keystore before the first refresh", () => {
    const js = fs.readFileSync("public/app.js", "utf8");

    expect(js).toContain('createConnectionSettingsStore');
    expect(js).toContain('await connectionSettings.load()');
    expect(js).toContain('await connectionSettings.save({ token, apiBase })');
    expect(js).not.toContain('localStorage.getItem("openclawToken")');
    expect(js).not.toContain('localStorage.setItem("openclawToken"');
    expect(js).not.toContain('localStorage.getItem("openclawApiBase")');
    expect(js).not.toContain('localStorage.setItem("openclawApiBase"');
  });

  it("shows a native-only background notification toggle without prompting browsers", () => {
    const html = fs.readFileSync("public/index.html", "utf8");
    const js = fs.readFileSync("public/app.js", "utf8");

    expect(html).toContain('id="background-notifications-section"');
    expect(html).toContain('id="background-notifications"');
    expect(html).toContain('id="background-notifications-status"');
    expect(html).toContain("锁屏和切到后台后继续接收");
    expect(html).toContain("会略微增加耗电");
    expect(js).toContain("getBackgroundNotificationsPlugin");
    expect(js).toContain("window.Capacitor?.isNativePlatform?.()");
    expect(js).toContain('window.Capacitor?.getPlatform?.() === "android"');
    expect(js).toContain("initBackgroundNotifications");
    expect(js).toContain("await plugin.status()");
    expect(js).toContain("await plugin.enable()");
    expect(js).toContain("await plugin.disable()");
    expect(js).toContain("els.backgroundNotificationsSection.hidden = false");
    expect(js).toContain("result.connectionState");
    expect(js).toContain("后台连接已恢复");
    expect(js).not.toContain("Notification.requestPermission");
  });
});
