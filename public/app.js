const lanApiBase = "http://192.168.101.8:1314";
const defaultDispatcherToken = "";
const appVersion = "1.3.3";
const releaseNotes = "修复手机消息误发到电脑当前 Codex 对话的问题，默认改用会话安全通道发送任务。";
let token = localStorage.getItem("openclawToken") || defaultDispatcherToken;
let apiBase = getStoredApiBase();

const selectionKeys = {
  project: "openclawActiveProject",
  conversation: "openclawActiveConversation",
  autoFollowConversation: "openclawAutoFollowConversation"
};

const state = {
  projects: [],
  conversations: [],
  tasks: [],
  activeTasks: [],
  approvals: [],
  agents: [],
  activeProjectId: localStorage.getItem(selectionKeys.project) || "",
  activeConversationId: localStorage.getItem(selectionKeys.conversation) || "",
  autoFollowConversation: localStorage.getItem(selectionKeys.autoFollowConversation) !== "0",
  approvalInboxOpen: false
};

const scrollState = {
  activeConversationId: "",
  forceBottom: true
};

let knownPendingApprovalIds = new Set();

const modeLabels = {
  "dry-run": "只测试连接",
  codex: "正式让 Codex 执行"
};

const statusLabels = {
  queued: "排队中",
  running: "执行中",
  waiting_approval: "等待授权",
  cancelling: "正在取消",
  cancelled: "已取消",
  completed: "已完成",
  failed: "失败"
};

const noisyLogPatterns = [
  /WARN codex_core_skills::loader: ignoring interface\.icon_/,
  /^tokens used\s*$/i,
  /^Reading additional input from stdin/i
];

const els = {
  status: document.querySelector("#status"),
  statusIcon: document.querySelector("#status-icon"),
  mode: document.querySelector("#mode"),
  prompt: document.querySelector("#prompt"),
  form: document.querySelector("#chat-form"),
  submit: document.querySelector("#submit"),
  refresh: document.querySelector("#refresh"),
  syncConversations: document.querySelector("#sync-conversations"),
  checkUpdate: document.querySelector("#check-update"),
  installUpdate: document.querySelector("#install-update"),
  updateStatus: document.querySelector("#update-status"),
  appVersion: document.querySelector("#app-version"),
  releaseNotes: document.querySelector("#release-notes"),
  token: document.querySelector("#token"),
  apiBase: document.querySelector("#api-base"),
  saveApiBase: document.querySelector("#save-api-base"),
  resetApiBase: document.querySelector("#reset-api-base"),
  saveToken: document.querySelector("#save-token"),
  resetToken: document.querySelector("#reset-token"),
  agents: document.querySelector("#agents"),
  messages: document.querySelector("#messages"),
  activeSessions: document.querySelector("#active-sessions"),
  approvalInbox: document.querySelector("#approval-inbox"),
  approvalToggle: document.querySelector("#approval-toggle"),
  approvalCount: document.querySelector("#approval-count"),
  currentProjectName: document.querySelector("#current-project-name"),
  conversationTitle: document.querySelector("#conversation-title"),
  conversationList: document.querySelector("#conversation-list"),
  newConversation: document.querySelector("#new-conversation"),
  sidebar: document.querySelector("#conversation-sidebar"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarClose: document.querySelector("#sidebar-close"),
  sidebarScrim: document.querySelector("#sidebar-scrim"),
  settingsPanel: document.querySelector("#settings-panel"),
  settingsOpen: document.querySelector("#settings-open"),
  settingsClose: document.querySelector("#settings-close"),
  settingsScrim: document.querySelector("#settings-scrim"),
  autoFollowConversation: document.querySelector("#auto-follow-conversation")
};

function getLatestConversation() {
  return state.conversations[0];
}

function setAutoFollow(enabled) {
  state.autoFollowConversation = Boolean(enabled);
  if (els.autoFollowConversation) {
    els.autoFollowConversation.checked = state.autoFollowConversation;
  }
  persistSelection();
}

els.autoFollowConversation.checked = state.autoFollowConversation;
els.token.value = token;
els.apiBase.value = apiBase;
els.refresh.addEventListener("click", () => refresh());
els.syncConversations.addEventListener("click", syncConversations);
els.autoFollowConversation.addEventListener("change", () => {
  setAutoFollow(els.autoFollowConversation.checked);
  if (state.autoFollowConversation) {
    ensureSelection();
    renderAll();
  }
});
els.checkUpdate.addEventListener("click", checkAndroidUpdate);
els.installUpdate.addEventListener("click", installAndroidUpdate);
els.saveApiBase.addEventListener("click", saveApiBase);
els.resetApiBase.addEventListener("click", resetApiBase);
els.saveToken.addEventListener("click", saveToken);
els.resetToken.addEventListener("click", resetToken);
els.form.addEventListener("submit", submitTask);
els.newConversation.addEventListener("click", () => createNewConversation());
els.sidebarToggle.addEventListener("click", openSidebar);
els.sidebarClose.addEventListener("click", closeSidebar);
els.sidebarScrim.addEventListener("click", closeSidebar);
els.approvalToggle.addEventListener("click", toggleApprovalInbox);
els.settingsOpen.addEventListener("click", openSettings);
els.settingsClose.addEventListener("click", closeSettings);
els.settingsScrim.addEventListener("click", closeSettings);

initAndroidUpdateControls();
renderAppVersion();
await refresh();
setInterval(() => refresh(), 2000);

function getAndroidUpdater() {
  return window.Capacitor?.Plugins?.AndroidUpdater;
}

function getDispatcherHttp() {
  return window.Capacitor?.Plugins?.DispatcherHttp;
}

function defaultApiBase() {
  const localHosts = new Set(["", "localhost", "127.0.0.1"]);
  if (location.protocol === "capacitor:" || localHosts.has(location.hostname)) {
    return lanApiBase;
  }
  return "";
}

function getStoredApiBase() {
  const stored = normalizeApiBase(localStorage.getItem("openclawApiBase") || "");
  if (!stored || isOldDefaultApiBase(stored)) {
    localStorage.setItem("openclawApiBase", defaultApiBase());
    return defaultApiBase();
  }
  return stored;
}

function isOldDefaultApiBase(value) {
  return value === "http://100.69.253.5:1314" || value === "http://leinews:1314" || value === "http://openclaw-nas:4318";
}

function initAndroidUpdateControls() {
  if (!getAndroidUpdater()) {
    return;
  }
  els.checkUpdate.hidden = false;
}

function renderAppVersion() {
  if (els.appVersion) {
    els.appVersion.textContent = `v${appVersion}`;
  }
  if (els.releaseNotes) {
    els.releaseNotes.textContent = releaseNotes;
  }
}

async function checkAndroidUpdate() {
  const updater = getAndroidUpdater();
  if (!updater) {
    return;
  }
  setUpdateStatus("正在检查更新...");
  els.checkUpdate.disabled = true;
  try {
    const result = await updater.check();
    if (result.hasUpdate) {
      els.installUpdate.hidden = false;
      setUpdateStatus(`发现新版本 ${result.versionName || result.versionCode}。${result.notes || ""}`.trim());
    } else {
      els.installUpdate.hidden = true;
      setUpdateStatus(`已是最新版 ${result.currentVersionName || result.currentVersionCode}。`);
    }
  } catch (error) {
    els.installUpdate.hidden = true;
    setUpdateStatus(`检查更新失败：${error.message || error}`);
  } finally {
    els.checkUpdate.disabled = false;
  }
}

async function installAndroidUpdate() {
  const updater = getAndroidUpdater();
  if (!updater) {
    return;
  }
  setUpdateStatus("正在下载更新...");
  els.installUpdate.disabled = true;
  try {
    const result = await updater.downloadAndInstall();
    if (result.status === "install_permission_required") {
      setUpdateStatus(result.message || "请先允许安装未知来源应用，然后再点一次立即升级。");
    } else if (result.status === "installer_opened") {
      setUpdateStatus(result.message || "已打开系统安装器。");
    } else {
      setUpdateStatus("当前已经是最新版。");
      els.installUpdate.hidden = true;
    }
  } catch (error) {
    setUpdateStatus(`升级失败：${error.message || error}`);
  } finally {
    els.installUpdate.disabled = false;
  }
}

function setUpdateStatus(message) {
  els.updateStatus.hidden = !message;
  els.updateStatus.textContent = message;
}

async function refresh() {
  if (!token) {
    els.status.textContent = "请输入访问密码";
    setConnectionState("pending", "请输入访问密码");
    renderEmptyState();
    return;
  }

  try {
    const projectsPayload = await api("/api/projects");
    const agentsPayload = api("/api/agents");
    const approvalsPayload = api("/api/approvals?status=pending");
    const projects = projectsPayload.projects ?? [];
    const conversations = await loadRecentProjectConversations(projects);
    const agents = await agentsPayload;
    const approvals = await approvalsPayload;
    state.projects = projects;
    state.conversations = conversations;
    state.agents = agents.agents ?? [];
    state.approvals = approvals.approvals ?? [];
    state.activeTasks = await loadActiveSessionTasks();
    ensureSelection();
    await loadActiveTasks();
    renderAll();

    const online = state.agents.filter((agent) => agent.online).length;
    els.status.textContent = online > 0 ? `${online} 台电脑在线` : "没有电脑在线";
    setConnectionState(online > 0 ? "online" : "offline", online > 0 ? `${online} 台电脑在线` : "没有电脑在线");
  } catch (error) {
    els.status.textContent = "连接失败，请检查服务地址、密码或 NAS 服务";
    setConnectionState("offline", "连接失败");
    els.messages.innerHTML = `<div class="empty">连接失败：${escapeHtml(describeConnectionError(error))}</div>`;
  }
}

async function syncConversations() {
  if (!token) {
    return;
  }
  els.syncConversations.disabled = true;
  els.syncConversations.classList.add("syncing");
  els.syncConversations.title = "正在同步电脑 Codex 对话";
  try {
    await api("/api/conversations/sync", { method: "POST" });
    await refresh();
  } catch (error) {
    els.messages.innerHTML = `<div class="empty">同步失败：${escapeHtml(describeConnectionError(error))}</div>`;
  } finally {
    els.syncConversations.disabled = false;
    els.syncConversations.classList.remove("syncing");
    els.syncConversations.title = "同步电脑 Codex 对话";
  }
}

function setConnectionState(stateName, label) {
  els.statusIcon.className = `computer-status ${stateName}`;
  els.statusIcon.setAttribute("aria-label", label);
  els.statusIcon.title = label;
  els.status.dataset.state = stateName;
}

function saveToken() {
  token = els.token.value.trim();
  localStorage.setItem("openclawToken", token);
  refresh();
}

function saveApiBase() {
  apiBase = normalizeApiBase(els.apiBase.value);
  els.apiBase.value = apiBase;
  if (apiBase) {
    localStorage.setItem("openclawApiBase", apiBase);
  } else {
    localStorage.removeItem("openclawApiBase");
  }
  refresh();
}

function resetApiBase() {
  apiBase = lanApiBase;
  els.apiBase.value = apiBase;
  localStorage.setItem("openclawApiBase", apiBase);
  refresh();
}

function resetToken() {
  token = defaultDispatcherToken;
  els.token.value = token;
  localStorage.setItem("openclawToken", token);
  refresh();
}

async function submitTask(event) {
  event.preventDefault();
  const prompt = els.prompt.value.trim();
  const project = getActiveProject();
  if (!prompt || !token || !project) {
    return;
  }

  els.submit.disabled = true;
  els.submit.textContent = "发送中";

  try {
    const payload = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        conversationId: state.activeConversationId || undefined,
        mode: els.mode.value,
        prompt,
        source: "panel"
      })
    });
    if (payload.task?.conversationId) {
      state.activeConversationId = payload.task.conversationId;
      persistSelection();
    }
    els.prompt.value = "";
    requestMessageScrollToBottom();
    await refresh();
  } finally {
    els.submit.disabled = false;
    els.submit.textContent = "发送给 Codex";
  }
}

async function cancelTask(taskId) {
  await api(`/api/tasks/${taskId}/cancel`, { method: "POST" });
  await refresh();
}

async function resolveApproval(approvalId, approved) {
  const endpoint = approved ? "approve" : "deny";
  await api(`/api/approvals/${encodeURIComponent(approvalId)}/${endpoint}`, { method: "POST" });
  await refresh();
}

async function createNewConversation(projectId = state.activeProjectId) {
  const targetProjectId = projectId || state.projects[0]?.id;
  if (!token || !targetProjectId) {
    return;
  }

  els.newConversation.disabled = true;
  try {
    const payload = await api("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ projectId: targetProjectId, title: "新对话" })
    });
    setAutoFollow(false);
    state.activeProjectId = payload.conversation.projectId;
    state.activeConversationId = payload.conversation.id;
    persistSelection();
    requestMessageScrollToBottom();
    await refresh();
    closeSidebar();
    els.prompt.focus();
  } finally {
    els.newConversation.disabled = false;
  }
}

async function switchProject(projectId) {
  setAutoFollow(false);
  state.activeProjectId = projectId;
  state.activeConversationId = conversationsForProject(projectId)[0]?.id ?? "";
  persistSelection();
  requestMessageScrollToBottom();
  await loadActiveTasks();
  renderAll();
  closeSidebar();
}

async function switchConversation(conversationId) {
  setAutoFollow(false);
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    return;
  }
  state.activeProjectId = conversation.projectId;
  state.activeConversationId = conversation.id;
  persistSelection();
  requestMessageScrollToBottom();
  await loadActiveTasks();
  renderAll();
  closeSidebar();
}

async function loadActiveTasks() {
  if (!state.activeConversationId) {
    state.tasks = [];
    return;
  }

  const payload = await api(`/api/conversations/${state.activeConversationId}/tasks`);
  state.tasks = payload.tasks ?? [];
}

async function loadActiveSessionTasks() {
  const payload = await api("/api/tasks");
  return (payload.tasks ?? [])
    .filter(isActiveTask)
    .sort(compareActiveTasks);
}

async function loadRecentProjectConversations(projects) {
  if (!Array.isArray(projects) || projects.length === 0) {
    return [];
  }
  const responses = await Promise.all(
    projects.map((project) => api(`/api/conversations?projectId=${encodeURIComponent(project.id)}&limit=3`))
  );
  return responses
    .flatMap((item) => item.conversations ?? [])
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function renderAll() {
  renderHeader();
  renderModes();
  renderAgents();
  renderApprovals();
  renderActiveSessions();
  renderConversationSidebar();
  renderMessages();
}

function renderHeader() {
  const project = getActiveProject();
  const conversation = getActiveConversation();
  els.currentProjectName.textContent = project ? project.name : "选择项目";
  els.conversationTitle.textContent = conversation ? conversation.title : getActiveTaskForConversation(state.activeConversationId)?.prompt ?? "选择一个对话或新建对话";
}

function renderConversationSidebar() {
  if (state.projects.length === 0) {
    els.conversationList.innerHTML = `<div class="sidebar-empty">Win11 还没有同步 D:\\aixm 下的项目。</div>`;
    return;
  }

  els.conversationList.innerHTML = state.projects.map(renderProjectGroup).join("");

  els.conversationList.querySelectorAll("[data-project-id]").forEach((button) => {
    button.addEventListener("click", () => switchProject(button.dataset.projectId));
  });
  els.conversationList.querySelectorAll("[data-conversation-id]").forEach((button) => {
    button.addEventListener("click", () => switchConversation(button.dataset.conversationId));
  });
  els.conversationList.querySelectorAll("[data-start-project-id]").forEach((button) => {
    button.addEventListener("click", () => createNewConversation(button.dataset.startProjectId));
  });
}

function renderProjectGroup(project) {
  const activeProject = project.id === state.activeProjectId;
  const conversations = conversationsForProject(project.id);
  const conversationItems =
    conversations.length > 0
      ? conversations.map(renderConversationItem).join("")
      : `<button class="conversation-item muted" data-start-project-id="${escapeHtml(project.id)}" type="button">开始这个项目的第一段对话</button>`;

  return `
    <section class="project-group ${activeProject ? "active" : ""}">
      <button class="project-row" data-project-id="${escapeHtml(project.id)}" type="button">
        <span class="folder-icon" aria-hidden="true"></span>
        <span>${escapeHtml(project.name)}</span>
      </button>
      <div class="conversation-items">${conversationItems}</div>
    </section>
  `;
}

function renderConversationItem(conversation) {
  const active = conversation.id === state.activeConversationId;
  const source = conversation.source === "codex" ? "电脑" : "手机";
  return `
    <button class="conversation-item ${active ? "active" : ""}" data-conversation-id="${escapeHtml(conversation.id)}" type="button">
      <span>${escapeHtml(conversation.title)}</span>
      <time>${escapeHtml(source)} ${formatRelativeTime(conversation.updatedAt)}</time>
    </button>
  `;
}

function renderActiveSessions() {
  const tasks = state.activeTasks;
  els.activeSessions.hidden = tasks.length === 0;
  if (tasks.length === 0) {
    els.activeSessions.innerHTML = "";
    return;
  }

  els.activeSessions.innerHTML = `
    <div class="active-sessions-title">
      <strong>正在执行</strong>
      <span>${tasks.length} 个</span>
    </div>
    <div class="active-session-list">
      ${tasks.map(renderActiveSessionCard).join("")}
    </div>
  `;
  els.activeSessions.querySelectorAll("[data-active-task-id]").forEach((button) => {
    button.addEventListener("click", () => switchActiveTaskConversation(button.dataset.activeTaskId));
  });
}

function renderActiveSessionCard(task) {
  const project = state.projects.find((item) => item.id === task.projectId);
  const conversation = state.conversations.find((item) => item.id === task.conversationId);
  const active = task.conversationId === state.activeConversationId;
  const title = conversation?.title || task.prompt || "正在执行的对话";
  return `
    <button class="active-session-card ${active ? "active" : ""}" data-active-task-id="${escapeHtml(task.id)}" type="button">
      <span class="active-session-status ${escapeHtml(task.status)}">${escapeHtml(statusLabels[task.status] ?? task.status)}</span>
      <span class="active-session-main">${escapeHtml(compactText(title, 24))}</span>
      <span class="active-session-project">${escapeHtml(project?.name ?? task.projectId)}</span>
    </button>
  `;
}

async function switchActiveTaskConversation(taskId) {
  const task = state.activeTasks.find((item) => item.id === taskId);
  if (!task?.conversationId) {
    return;
  }
  setAutoFollow(false);
  state.activeProjectId = task.projectId;
  state.activeConversationId = task.conversationId;
  persistSelection();
  requestMessageScrollToBottom();
  await loadActiveTasks();
  renderAll();
}

function renderModes() {
  const project = getActiveProject();
  if (!project) {
    els.mode.innerHTML = `<option value="dry-run">只测试连接</option>`;
    els.mode.disabled = true;
    return;
  }

  const current = els.mode.value;
  els.mode.disabled = false;
  els.mode.innerHTML = project.allowedModes
    .map((mode) => `<option value="${escapeHtml(mode)}">${escapeHtml(modeLabels[mode] ?? mode)}</option>`)
    .join("");
  els.mode.value = project.allowedModes.includes(current) ? current : project.defaultMode;
}

function renderAgents() {
  const onlineAgents = state.agents.filter((agent) => agent.online);
  els.agents.innerHTML =
    onlineAgents
      .map(
        (agent) => `
          <div class="agent-chip">
            <strong>${escapeHtml(agent.id)}</strong>
            <span>在线，可以接任务</span>
          </div>
        `
      )
      .join("") || `<div class="empty">还没有 Win11 执行端在线</div>`;
}

function renderApprovals() {
  const pending = state.approvals.filter((approval) => approval.status === "pending");
  notifyPendingApprovals(pending);
  els.approvalToggle.classList.toggle("has-pending", pending.length > 0);
  els.approvalToggle.setAttribute("aria-expanded", state.approvalInboxOpen ? "true" : "false");
  els.approvalToggle.setAttribute("aria-label", pending.length > 0 ? `权限收件箱，${pending.length} 条待处理` : "权限收件箱，暂无待处理");
  els.approvalToggle.title = pending.length > 0 ? `${pending.length} 条权限待处理` : "权限收件箱";
  els.approvalCount.hidden = pending.length === 0;
  els.approvalCount.textContent = String(pending.length);
  els.approvalInbox.hidden = !state.approvalInboxOpen;
  els.approvalInbox.innerHTML =
    pending.length > 0
      ? `
        <div class="approval-inbox-header">
          <strong>待处理权限</strong>
          <span>${pending.length} 条</span>
        </div>
        ${pending.map(renderApprovalCard).join("")}
      `
      : `<div class="approval-empty">暂无需要处理的权限。</div>`;
  els.approvalInbox.querySelectorAll("[data-approval-approve]").forEach((button) => {
    button.addEventListener("click", () => resolveApproval(button.dataset.approvalApprove, true));
  });
  els.approvalInbox.querySelectorAll("[data-approval-deny]").forEach((button) => {
    button.addEventListener("click", () => resolveApproval(button.dataset.approvalDeny, false));
  });
}

function renderApprovalCard(approval) {
  return `
    <article class="approval-card">
      <div class="approval-card-title">
        <strong>电脑 Codex 正在等待授权</strong>
        <span>${escapeHtml(approval.projectId)}</span>
      </div>
      <pre>${escapeHtml(approval.message)}</pre>
      <div class="approval-actions">
        <button class="secondary compact-button" data-approval-deny="${escapeHtml(approval.id)}" type="button">拒绝</button>
        <button class="compact-button" data-approval-approve="${escapeHtml(approval.id)}" type="button">批准</button>
      </div>
    </article>
  `;
}

function toggleApprovalInbox() {
  state.approvalInboxOpen = !state.approvalInboxOpen;
  renderApprovals();
}

function closeApprovalInbox() {
  state.approvalInboxOpen = false;
  renderApprovals();
}

function notifyPendingApprovals(pending) {
  const currentIds = new Set(pending.map((approval) => approval.id));
  const hasNewApproval = pending.some((approval) => !knownPendingApprovalIds.has(approval.id));
  knownPendingApprovalIds = currentIds;
  if (!hasNewApproval || pending.length === 0) {
    return;
  }
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate([80, 40, 80]);
  }
}

function renderMessages() {
  const scrollIntent = captureMessageScrollIntent();
  if (!token) {
    renderEmptyState();
    finishMessageRender(scrollIntent);
    return;
  }
  if (!getActiveProject()) {
    els.messages.innerHTML = `<div class="empty">Win11 还没有把 D:\\aixm 下的项目同步回来，点刷新再看。</div>`;
    finishMessageRender(scrollIntent);
    return;
  }
  if (!state.activeConversationId) {
    els.messages.innerHTML = `<div class="empty">左侧点“新对话”，或者选择一个已有对话。</div>`;
    finishMessageRender(scrollIntent);
    return;
  }
  const conversation = getActiveConversation();
  const historyMessages = conversation?.messages ?? [];
  if (state.tasks.length === 0 && historyMessages.length === 0) {
    els.messages.innerHTML = `<div class="empty">这个对话还没有消息。直接在下面输入给 Codex 的话就行。</div>`;
    finishMessageRender(scrollIntent);
    return;
  }

  const historyHtml = historyMessages.length > 0 ? renderSyncedHistory(historyMessages) : "";
  const visibleTasks = getVisibleTasksForConversation(conversation, historyMessages);
  els.messages.innerHTML = renderTimeline(historyMessages, visibleTasks, historyHtml);

  document.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", () => cancelTask(button.dataset.cancel));
  });
  finishMessageRender(scrollIntent);
}

function requestMessageScrollToBottom() {
  scrollState.forceBottom = true;
}

function captureMessageScrollIntent() {
  return {
    conversationId: state.activeConversationId,
    previousScrollTop: els.messages.scrollTop,
    shouldStickToBottom:
      scrollState.forceBottom ||
      scrollState.activeConversationId !== state.activeConversationId ||
      isMessageListNearBottom()
  };
}

function finishMessageRender(intent) {
  if (intent.shouldStickToBottom) {
    els.messages.scrollTop = els.messages.scrollHeight;
  } else {
    els.messages.scrollTop = Math.min(intent.previousScrollTop, els.messages.scrollHeight);
  }
  scrollState.activeConversationId = intent.conversationId;
  scrollState.forceBottom = false;
}

function isMessageListNearBottom() {
  const distance = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
  return distance < 80;
}

function getVisibleTasksForConversation(conversation, historyMessages) {
  if (conversation?.source !== "codex") {
    return state.tasks;
  }
  return state.tasks.filter((task) => {
    const representedInHistory = historyMessages.some((message) => message.role === "user" && message.text.trim() === task.prompt.trim());
    if (!representedInHistory) {
      return true;
    }
    return task.status === "queued" || task.status === "running" || task.status === "waiting_approval" || task.status === "cancelling";
  });
}

function renderSyncedHistory(messages) {
  return messages.length > 0 ? `<p class="history-note">电脑 Codex 最近历史</p>` : "";
}

function renderTimeline(historyMessages, tasks, prefixHtml) {
  const items = [];
  historyMessages.forEach((message, index) => {
    items.push({
      at: message.at,
      order: index,
      html: renderHistoryMessage(message)
    });
  });

  tasks.forEach((task, index) => {
    const order = historyMessages.length + index * 2;
    items.push({
      at: task.createdAt,
      order,
      html: renderUserMessage(task)
    });
    items.push({
      at: task.finishedAt || task.updatedAt || task.createdAt,
      order: order + 1,
      html: renderCodexMessage(task)
    });
  });

  const html = items
    .sort(compareTimelineItems)
    .map((item) => item.html)
    .join("");
  return prefixHtml + html;
}

function compareTimelineItems(left, right) {
  const leftTime = Date.parse(left.at || "");
  const rightTime = Date.parse(right.at || "");
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) {
    return Number.isFinite(leftTime) ? -1 : 1;
  }
  return left.order - right.order;
}

function renderHistoryMessage(message) {
  const isUser = message.role === "user";
  const text = sanitizeDisplayText(message.text);
  return `
    <article class="message ${isUser ? "user-message" : "codex-message"}">
      <div class="bubble">
        ${isUser ? "" : `<div class="message-name">Codex</div>`}
        <div class="message-text">${escapeHtml(text)}</div>
      </div>
    </article>
  `;
}

function renderUserMessage(task) {
  return `
    <article class="message user-message">
      <div class="bubble">
        <div class="message-text">${escapeHtml(task.prompt)}</div>
      </div>
    </article>
  `;
}

function renderCodexMessage(task) {
  const cancellable = task.status === "queued" || task.status === "running" || task.status === "cancelling";
  const usefulLogs = getUsefulLogs(task);
  const answerText = getAnswerText(task, usefulLogs);
  return `
    <article class="message codex-message">
      <div class="bubble">
        <div class="message-name">Codex</div>
        ${answerText ? `<div class="answer-text">${escapeHtml(answerText)}</div>` : ""}
        ${shouldShowTaskStatus(task, answerText) ? `<div class="task-status-line">${escapeHtml(describeTaskStatus(task))}</div>` : ""}
        ${shouldShowTaskMeta(task, answerText) ? renderTaskDetails(task) : ""}
        ${shouldShowTechnicalLog(task) && usefulLogs.raw ? `<details class="technical-log"><summary>查看技术日志</summary><pre>${escapeHtml(usefulLogs.raw)}</pre></details>` : ""}
        ${cancellable ? `<button class="danger" data-cancel="${escapeHtml(task.id)}" type="button">取消这次任务</button>` : ""}
      </div>
    </article>
  `;
}

function getAnswerText(task, usefulLogs) {
  if (task.mode === "dry-run") {
    return "";
  }
  if (usefulLogs.summary) {
    return sanitizeDisplayText(usefulLogs.summary);
  }
  if (task.result?.summary && !isGenericCodexSummary(task.result.summary)) {
    return sanitizeDisplayText(task.result.summary);
  }
  if (task.status === "completed") {
    return "完成了。";
  }
  return "";
}

function isGenericCodexSummary(summary) {
  return /^Codex task completed\.?$/i.test(String(summary).trim());
}

function shouldShowTaskStatus(task, answerText) {
  if (task.status === "completed" && answerText) {
    return false;
  }
  return true;
}

function shouldShowTaskMeta(task, answerText) {
  if (task.status === "completed") {
    return false;
  }
  return task.status === "failed" || task.status === "cancelled" || task.status === "waiting_approval";
}

function shouldShowTechnicalLog(task) {
  return task.status === "failed" || task.status === "waiting_approval";
}

function describeTaskStatus(task) {
  if (task.status === "queued") {
    return "收到，正在排队，等 Win11 电脑领取。";
  }
  if (task.status === "running") {
    return "Win11 已经开始执行，我会把结果同步回来。";
  }
  if (task.status === "waiting_approval") {
    return "电脑 Codex 正在等你批准授权，点上方提示里的“批准”继续。";
  }
  if (task.status === "cancelling") {
    return "正在通知 Win11 停止这次任务。";
  }
  if (task.status === "cancelled") {
    return "这次任务已取消。";
  }
  if (task.status === "failed") {
    return `执行失败：${task.error ?? "请查看技术日志"}`;
  }
  if (task.mode === "dry-run") {
    return "连接测试完成：Win11 可以收到任务，但没有真正调用 Codex。";
  }
  return "任务已完成。";
}

function renderTaskDetails(task) {
  const rows = [
    ["项目", task.projectId],
    ["执行方式", modeLabels[task.mode] ?? task.mode],
    ["状态", statusLabels[task.status] ?? task.status]
  ];
  if (task.agentId) {
    rows.push(["执行端", task.agentId]);
  }
  if (task.result?.diffSummary) {
    rows.push(["变更摘要", task.result.diffSummary]);
  }
  if (task.error) {
    rows.push(["错误", task.error]);
  }

  return `
    <details class="task-details">
      <summary>任务详情</summary>
      <dl>
        ${rows
          .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
          .join("")}
      </dl>
    </details>
  `;
}

function getUsefulLogs(task) {
  const visible = task.logs
    .flatMap((log) => splitLogText(log.text).map((line) => ({ stream: log.stream, line })))
    .filter(({ line }) => line.trim())
    .filter(({ line }) => !isNoisyLog(line));

  const stdout = visible
    .filter((log) => log.stream === "stdout")
    .map((log) => log.line)
    .join("\n")
    .trim();
  const raw = visible
    .slice(-8)
    .map((log) => `[${log.stream}] ${log.line}`)
    .join("\n")
    .trim();

  return {
    summary: sanitizeDisplayText(stdout),
    raw
  };
}

function sanitizeDisplayText(value) {
  return String(value)
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLogText(text) {
  return String(text).split(/\r?\n/);
}

function isNoisyLog(line) {
  return noisyLogPatterns.some((pattern) => pattern.test(line.trim()));
}

function renderEmptyState() {
  els.currentProjectName.textContent = "手机遥控 Codex";
  els.conversationTitle.textContent = "像和 Codex 聊天一样发任务";
  els.conversationList.innerHTML = `<div class="sidebar-empty">保存访问密码后显示项目和对话。</div>`;
  els.agents.innerHTML = `<div class="empty">保存访问密码后显示 Win11 状态</div>`;
  state.activeTasks = [];
  els.activeSessions.hidden = true;
  els.activeSessions.innerHTML = "";
  state.approvalInboxOpen = false;
  knownPendingApprovalIds = new Set();
  els.approvalToggle.classList.remove("has-pending");
  els.approvalToggle.setAttribute("aria-expanded", "false");
  els.approvalToggle.setAttribute("aria-label", "权限收件箱，暂无待处理");
  els.approvalCount.hidden = true;
  els.approvalCount.textContent = "0";
  els.approvalInbox.hidden = true;
  els.approvalInbox.innerHTML = "";
  els.messages.innerHTML = `<div class="empty">保存访问密码后就可以像聊天一样给 Codex 发任务。</div>`;
}

function ensureSelection() {
  const activeConversationStillRunning = hasActiveTaskConversation(state.activeConversationId);
  if (!state.conversations.length && state.activeConversationId && !activeConversationStillRunning) {
    state.activeConversationId = "";
  }

  if (!state.projects.some((project) => project.id === state.activeProjectId)) {
    state.activeProjectId = getLatestConversation()?.projectId || state.projects[0]?.id || "";
  }

  if (state.autoFollowConversation) {
    const latestConversation = getLatestConversation();
    if (latestConversation) {
      state.activeProjectId = latestConversation.projectId;
      state.activeConversationId = latestConversation.id;
    } else {
      state.activeConversationId = "";
    }
    persistSelection();
    return;
  }

  const conversations = conversationsForProject(state.activeProjectId);
  if (!conversations.some((conversation) => conversation.id === state.activeConversationId) && !activeConversationStillRunning) {
    state.activeConversationId = conversations[0]?.id ?? "";
  }

  persistSelection();
}

function persistSelection() {
  localStorage.setItem(selectionKeys.autoFollowConversation, state.autoFollowConversation ? "1" : "0");
  if (state.activeProjectId) {
    localStorage.setItem(selectionKeys.project, state.activeProjectId);
  }
  if (state.activeConversationId) {
    localStorage.setItem(selectionKeys.conversation, state.activeConversationId);
  } else {
    localStorage.removeItem(selectionKeys.conversation);
  }
}

function getActiveProject() {
  return state.projects.find((project) => project.id === state.activeProjectId);
}

function getActiveConversation() {
  return state.conversations.find((conversation) => conversation.id === state.activeConversationId);
}

function conversationsForProject(projectId) {
  return state.conversations.filter((conversation) => conversation.projectId === projectId);
}

function hasActiveTaskConversation(conversationId) {
  return Boolean(conversationId) && state.activeTasks.some((task) => task.conversationId === conversationId);
}

function getActiveTaskForConversation(conversationId) {
  return state.activeTasks.find((task) => task.conversationId === conversationId);
}

function isActiveTask(task) {
  return task && ["queued", "running", "waiting_approval", "cancelling"].includes(task.status);
}

function compareActiveTasks(left, right) {
  const priority = {
    waiting_approval: 0,
    running: 1,
    queued: 2,
    cancelling: 3
  };
  const leftPriority = priority[left.status] ?? 9;
  const rightPriority = priority[right.status] ?? 9;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""));
}

function compactText(value, maxLength) {
  const text = sanitizeDisplayText(value).replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) {
    return "刚刚";
  }
  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)} 分`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)} 小时`;
  }
  return `${Math.floor(diffMs / day)} 天`;
}

function openSidebar() {
  els.sidebar.classList.add("open");
  els.sidebarScrim.hidden = false;
}

function closeSidebar() {
  els.sidebar.classList.remove("open");
  els.sidebarScrim.hidden = true;
}

function openSettings() {
  els.settingsPanel.hidden = false;
  els.settingsScrim.hidden = false;
}

function closeSettings() {
  els.settingsPanel.hidden = true;
  els.settingsScrim.hidden = true;
}

window.openclawHandleAndroidBack = function openclawHandleAndroidBack() {
  if (state.approvalInboxOpen) {
    closeApprovalInbox();
    return true;
  }
  if (!els.settingsPanel.hidden) {
    closeSettings();
    return true;
  }
  if (els.sidebar.classList.contains("open")) {
    closeSidebar();
    return true;
  }
  if (document.activeElement && typeof document.activeElement.blur === "function") {
    document.activeElement.blur();
  }
  return false;
};

async function api(url, options = {}) {
  const nativeHttp = getDispatcherHttp();
  if (nativeHttp) {
    const result = await nativeHttp.request({
      method: options.method || "GET",
      baseUrl: apiBase,
      path: url,
      token,
      body: options.body || ""
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error(result.body || `HTTP ${result.status}`);
    }
    return JSON.parse(result.body || "{}");
  }

  const response = await fetch(`${apiBase}${url}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

function normalizeApiBase(value) {
  return String(value).trim().replace(/\/+$/, "");
}

function describeConnectionError(error) {
  const message = error?.message || String(error);
  const transport = getDispatcherHttp() ? "Android 原生请求" : "WebView fetch";
  return `服务地址：${apiBase || "未设置"}\n请求方式：${transport}\n错误：${message}\n\n请到设置里依次点“恢复局域网地址”和“恢复默认密码”，再点刷新。`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}
