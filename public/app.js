import { createRefreshGate } from "/refreshGate.js";
import { deriveConnectionStatus } from "/connectionStatus.js";
import { createRealtimeClient } from "/realtimeClient.js";
import { applyMobileEvent } from "/realtimeState.js";
import { createLifecycleRecovery } from "/lifecycleRecovery.js";
import { buildDiagnosticsSnapshot, formatSanitizedDiagnostics } from "/diagnostics.js";
import { createConnectionSettingsStore } from "/connectionSettings.js";

const lanApiBase = "http://192.168.101.8:1314";
const defaultDispatcherToken = "";
const appVersion = "1.8.0";
const releaseNotes = "NAS 服务地址和访问密码改用 Android Keystore 加密保存；升级后自动迁移旧设置，无需重新输入。";
let token = defaultDispatcherToken;
let apiBase = defaultApiBase();

const connectionSettings = createConnectionSettingsStore({
  nativeStore: getSecureConnectionPlugin(),
  localStorage,
  defaultApiBase
});

const selectionKeys = {
  project: "openclawActiveProject",
  conversation: "openclawActiveConversation",
  autoFollowConversation: "openclawAutoFollowConversation",
  windowAliases: "openclawWindowAliases",
  realtimeCursor: "openclawRealtimeCursor",
  realtimeClient: "openclawRealtimeClient",
  pendingSends: "openclawPendingSends"
};

const realtimeClientId = getOrCreateRealtimeClientId();

const state = {
  projects: [],
  conversations: [],
  tasks: [],
  activeTasks: [],
  approvals: [],
  agents: [],
  codexWindows: [],
  health: null,
  latencyMs: null,
  realtimeState: "connecting",
  latestError: "",
  conversationTaskStates: {},
  pendingSends: loadPendingSends(),
  activeProjectId: localStorage.getItem(selectionKeys.project) || "",
  activeConversationId: localStorage.getItem(selectionKeys.conversation) || "",
  autoFollowConversation: localStorage.getItem(selectionKeys.autoFollowConversation) !== "0",
  windowAliases: loadWindowAliases(),
  approvalInboxOpen: false,
  windowPickerOpen: false
};

const scrollState = {
  activeConversationId: "",
  forceBottom: true,
  unread: false
};

let knownPendingApprovalIds = new Set();
let realtime;
let lifecycleRecovery;
const refresh = createRefreshGate(refreshNow);

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
  failed: "失败",
  sending: "正在发送",
  send_failed: "发送失败"
};

const noisyLogPatterns = [
  /WARN codex_core_skills::loader: ignoring interface\.icon_/,
  /^tokens used\s*$/i,
  /^Reading additional input from stdin/i
];

const els = {
  status: document.querySelector("#status"),
  statusIcon: document.querySelector("#status-icon"),
  connectionDetails: document.querySelector("#connection-details"),
  nasStatus: document.querySelector("#nas-status"),
  agentStatus: document.querySelector("#agent-status"),
  codexStatus: document.querySelector("#codex-status"),
  mode: document.querySelector("#mode"),
  prompt: document.querySelector("#prompt"),
  form: document.querySelector("#chat-form"),
  submit: document.querySelector("#submit"),
  submitError: document.querySelector("#submit-error"),
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
  jumpToLatest: document.querySelector("#jump-to-latest"),
  activeSessions: document.querySelector("#active-sessions"),
  currentWindowToggle: document.querySelector("#current-window-toggle"),
  currentWindowLabel: document.querySelector("#current-window-label"),
  windowPicker: document.querySelector("#window-picker"),
  approvalInbox: document.querySelector("#approval-inbox"),
  approvalToggle: document.querySelector("#approval-toggle"),
  approvalCount: document.querySelector("#approval-count"),
  refreshWindowBinding: document.querySelector("#refresh-window-binding"),
  refreshWindowHelp: document.querySelector("#refresh-window-help"),
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
  autoFollowConversation: document.querySelector("#auto-follow-conversation"),
  diagnosticsSummary: document.querySelector("#diagnostics-summary"),
  exportDiagnostics: document.querySelector("#export-diagnostics"),
  diagnosticsStatus: document.querySelector("#diagnostics-status")
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

await loadConnectionSettings();
els.autoFollowConversation.checked = state.autoFollowConversation;
els.token.value = token;
els.apiBase.value = apiBase;
els.refresh.addEventListener("click", () => refresh());
els.statusIcon.addEventListener("click", toggleConnectionDetails);
els.syncConversations.addEventListener("click", syncConversations);
els.autoFollowConversation.addEventListener("change", () => {
  setAutoFollow(els.autoFollowConversation.checked);
  if (state.autoFollowConversation) {
    ensureSelection();
    renderAll();
  }
});
els.refreshWindowBinding.addEventListener("change", bindActiveConversationRefreshWindow);
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
els.currentWindowToggle.addEventListener("click", toggleWindowPicker);
els.settingsOpen.addEventListener("click", openSettings);
els.settingsClose.addEventListener("click", closeSettings);
els.settingsScrim.addEventListener("click", closeSettings);
els.jumpToLatest.addEventListener("click", jumpToLatestMessage);
els.exportDiagnostics.addEventListener("click", exportDiagnostics);
els.messages.addEventListener("scroll", () => {
  if (isMessageListNearBottom()) {
    clearActiveConversationUnread();
  }
});

initAndroidUpdateControls();
renderAppVersion();
await refresh();
realtime = createRealtimeClient({
  clientId: realtimeClientId,
  getApiBase: () => apiBase,
  getToken: () => token,
  getLastEventId: getRealtimeCursor,
  setLastEventId: setRealtimeCursor,
  onEvent: handleRealtimeEvent,
  onSyncRequired: reconcileRealtimeState,
  onState: renderRealtimeConnectionState
});
realtime.start();
lifecycleRecovery = createLifecycleRecovery({
  restartRealtime: () => realtime.restart(),
  reconcile: () => refresh()
});
lifecycleRecovery.start();
setInterval(() => refresh(), 30000);

function getAndroidUpdater() {
  return window.Capacitor?.Plugins?.AndroidUpdater;
}

function getDispatcherHttp() {
  return window.Capacitor?.Plugins?.DispatcherHttp;
}

function getSecureConnectionPlugin() {
  return window.Capacitor?.Plugins?.SecureConnection;
}

function defaultApiBase() {
  const localHosts = new Set(["", "localhost", "127.0.0.1"]);
  if (location.protocol === "capacitor:" || localHosts.has(location.hostname)) {
    return lanApiBase;
  }
  return "";
}

async function loadConnectionSettings() {
  try {
    const loaded = await connectionSettings.load();
    token = loaded.token || defaultDispatcherToken;
    apiBase = normalizeApiBase(loaded.apiBase);
    if (!apiBase || isOldDefaultApiBase(apiBase)) {
      apiBase = defaultApiBase();
      await connectionSettings.save({ token, apiBase });
    }
  } catch (error) {
    token = defaultDispatcherToken;
    apiBase = defaultApiBase();
    state.latestError = `安全设置读取失败：${error?.message || error}`;
  }
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

async function refreshNow() {
  if (!token) {
    els.status.textContent = "请输入访问密码";
    setConnectionState({ level: "recovering", label: "需要密码", detail: "请输入访问密码" });
    renderConnectionDetails({ nasReachable: false, onlineAgents: 0, readyCodex: 0 });
    renderEmptyState();
    return;
  }

  try {
    const projectsPayload = await api("/api/projects");
    const healthStartedAt = performance.now();
    const healthPayload = api("/api/health").then((payload) => {
      state.latencyMs = Math.max(0, Math.round(performance.now() - healthStartedAt));
      return payload;
    });
    const agentsPayload = api("/api/agents");
    const approvalsPayload = api("/api/approvals?status=pending");
    const windowsPayload = api("/api/codex-windows");
    const projects = projectsPayload.projects ?? [];
    const conversations = await loadRecentProjectConversations(projects);
    const agents = await agentsPayload;
    const approvals = await approvalsPayload;
    const windows = await windowsPayload;
    const health = await healthPayload;
    state.health = health;
    state.latestError = "";
    state.projects = projects;
    state.conversations = conversations;
    state.agents = agents.agents ?? [];
    state.approvals = approvals.approvals ?? [];
    state.codexWindows = windows.windows ?? [];
    state.activeTasks = await loadActiveSessionTasks();
    ensureSelection();
    await loadActiveTasks();
    renderAll();

    const connectionInput = {
      nasReachable: health.services?.nas?.reachable === true,
      onlineAgents: Number(health.services?.agents?.online ?? 0),
      readyCodex: Number(health.services?.codex?.ready ?? 0)
    };
    const connectionStatus = deriveConnectionStatus(connectionInput);
    els.status.textContent = connectionStatus.detail;
    setConnectionState(connectionStatus);
    renderConnectionDetails(connectionInput);
  } catch (error) {
    state.latestError = error?.message || String(error);
    els.status.textContent = "连接失败，请检查服务地址、密码或 NAS 服务";
    setConnectionState({ level: "offline", label: "未连接", detail: "无法连接 NAS" });
    renderConnectionDetails({ nasReachable: false, onlineAgents: 0, readyCodex: 0 });
    els.messages.innerHTML = `<div class="empty">连接失败：${escapeHtml(describeConnectionError(error))}</div>`;
    renderDiagnostics();
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

function setConnectionState(connectionStatus) {
  els.statusIcon.className = `connection-status computer-status ${connectionStatus.level}`;
  els.statusIcon.dataset.level = connectionStatus.level;
  els.statusIcon.setAttribute("aria-label", connectionStatus.label);
  els.statusIcon.title = connectionStatus.detail;
  els.status.dataset.state = connectionStatus.level;
}

function renderConnectionDetails({ nasReachable, onlineAgents, readyCodex }) {
  els.nasStatus.textContent = nasReachable ? "已连接" : "未连接";
  els.agentStatus.textContent = onlineAgents > 0 ? `${onlineAgents} 台在线` : "未上线";
  els.codexStatus.textContent = readyCodex > 0 ? "可用" : onlineAgents > 0 ? "恢复中" : "等待电脑";
}

function toggleConnectionDetails() {
  const willOpen = els.connectionDetails.hidden;
  els.connectionDetails.hidden = !willOpen;
  els.statusIcon.setAttribute("aria-expanded", String(willOpen));
}

async function saveToken() {
  token = els.token.value.trim();
  await saveConnectionSettingsAndReconnect();
}

async function saveApiBase() {
  apiBase = normalizeApiBase(els.apiBase.value);
  els.apiBase.value = apiBase;
  await saveConnectionSettingsAndReconnect();
}

async function resetApiBase() {
  apiBase = lanApiBase;
  els.apiBase.value = apiBase;
  await saveConnectionSettingsAndReconnect();
}

async function resetToken() {
  token = defaultDispatcherToken;
  els.token.value = token;
  await saveConnectionSettingsAndReconnect();
}

async function saveConnectionSettingsAndReconnect() {
  try {
    await connectionSettings.save({ token, apiBase });
    state.latestError = "";
    await refresh();
    realtime?.restart();
  } catch (error) {
    state.latestError = `安全设置保存失败：${error?.message || error}`;
    els.status.textContent = "保存失败，请查看连接诊断";
    renderDiagnostics();
  }
}

async function submitTask(event) {
  event.preventDefault();
  const prompt = els.prompt.value.trim();
  const project = getActiveProject();
  if (!prompt || !token || !project) {
    return;
  }

  const pending = createPendingSend({
    projectId: project.id,
    conversationId: state.activeConversationId,
    mode: els.mode.value,
    prompt
  });
  state.pendingSends[pending.clientMessageId] = pending;
  persistPendingSends();
  addOptimisticTask(pending);
  els.prompt.value = "";
  requestMessageScrollToBottom();
  renderAll();

  els.submit.disabled = true;
  setSubmitError("");

  try {
    await sendPendingRecord(pending);
  } catch (error) {
    markPendingSendFailed(pending.clientMessageId, error);
    setSubmitError(friendlySubmitError(error));
  } finally {
    els.submit.disabled = false;
  }
}

async function retryPendingSend(clientMessageId) {
  const pending = state.pendingSends[clientMessageId];
  if (!pending) {
    return;
  }
  markPendingSendSending(clientMessageId);
  setSubmitError("");
  try {
    await sendPendingRecord(pending);
  } catch (error) {
    markPendingSendFailed(clientMessageId, error);
    setSubmitError(friendlySubmitError(error));
  }
}

async function sendPendingRecord(pending) {
  const payload = await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      clientMessageId: pending.clientMessageId,
      projectId: pending.projectId,
      conversationId: pending.conversationId || undefined,
      mode: pending.mode,
      prompt: pending.prompt,
      source: "panel"
    })
  });
  if (!payload.task) {
    throw new Error("NAS 没有返回任务，请重试。");
  }
  applyMobileEvent(state, createLocalTaskEvent(payload.task));
  persistPendingSends();
  if (payload.task.conversationId) {
    state.activeConversationId = payload.task.conversationId;
    persistSelection();
  }
  renderAll();
}

function createPendingSend({ projectId, conversationId, mode, prompt }) {
  const now = new Date().toISOString();
  return {
    clientMessageId: createClientMessageId(),
    projectId,
    conversationId,
    mode,
    prompt,
    source: "panel",
    createdAt: now,
    updatedAt: now
  };
}

function addOptimisticTask(pending) {
  const task = pendingToTask(pending, "sending");
  state.tasks = [...state.tasks.filter((item) => item.clientMessageId !== pending.clientMessageId), task];
  state.activeTasks = [...state.activeTasks.filter((item) => item.clientMessageId !== pending.clientMessageId), task];
}

function markPendingSendSending(clientMessageId) {
  updateOptimisticTask(clientMessageId, { status: "sending", error: undefined, updatedAt: new Date().toISOString() });
  renderAll();
}

function markPendingSendFailed(clientMessageId, error) {
  updateOptimisticTask(clientMessageId, {
    status: "send_failed",
    error: friendlySubmitError(error),
    updatedAt: new Date().toISOString()
  });
  state.activeTasks = state.activeTasks.filter((task) => task.clientMessageId !== clientMessageId);
  renderAll();
}

function updateOptimisticTask(clientMessageId, changes) {
  state.tasks = state.tasks.map((task) => task.clientMessageId === clientMessageId ? { ...task, ...changes } : task);
}

function pendingToTask(pending, status = "sending") {
  return {
    id: `local:${pending.clientMessageId}`,
    clientMessageId: pending.clientMessageId,
    projectId: pending.projectId,
    conversationId: pending.conversationId,
    mode: pending.mode,
    prompt: pending.prompt,
    source: pending.source,
    status,
    logs: [],
    createdAt: pending.createdAt,
    updatedAt: pending.updatedAt
  };
}

function mergePendingTasks(tasks, conversationId) {
  const serverMessageIds = new Set(tasks.map((task) => task.clientMessageId).filter(Boolean));
  for (const clientMessageId of serverMessageIds) {
    delete state.pendingSends[clientMessageId];
  }
  persistPendingSends();
  const optimistic = Object.values(state.pendingSends)
    .filter((pending) => pending.conversationId === conversationId)
    .filter((pending) => !serverMessageIds.has(pending.clientMessageId))
    .map((pending) => pendingToTask(pending, "send_failed"));
  return [...tasks, ...optimistic];
}

function createLocalTaskEvent(task) {
  return {
    eventId: 0,
    type: "task.created",
    taskId: task.id,
    conversationId: task.conversationId,
    occurredAt: task.updatedAt || new Date().toISOString(),
    payload: { task }
  };
}

function persistPendingSends() {
  localStorage.setItem(selectionKeys.pendingSends, JSON.stringify(state.pendingSends));
}

function loadPendingSends() {
  try {
    const value = JSON.parse(localStorage.getItem(selectionKeys.pendingSends) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function createClientMessageId() {
  return `${realtimeClientId}:${createRandomId()}`;
}

function getOrCreateRealtimeClientId() {
  const stored = localStorage.getItem(selectionKeys.realtimeClient);
  if (stored) {
    return stored;
  }
  const created = `phone:${createRandomId()}`;
  localStorage.setItem(selectionKeys.realtimeClient, created);
  return created;
}

function createRandomId() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getRealtimeCursor() {
  const value = Number(localStorage.getItem(selectionKeys.realtimeCursor));
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function setRealtimeCursor(eventId) {
  if (Number.isInteger(eventId) && eventId >= 0) {
    localStorage.setItem(selectionKeys.realtimeCursor, String(eventId));
  }
}

async function handleRealtimeEvent(event) {
  const affectsActiveConversation = event.conversationId === state.activeConversationId;
  const userIsReadingHistory = affectsActiveConversation && !isMessageListNearBottom();
  applyMobileEvent(state, event);
  if (event.payload?.task?.conversationId) {
    updateConversationStatusFromTask(event.payload.task);
  }
  persistPendingSends();
  if (userIsReadingHistory) {
    markActiveConversationUnread();
  }
  renderConnectionFromRealtimeState();
  renderAll();
}

async function reconcileRealtimeState({ latestEventId }) {
  await refresh();
  return latestEventId;
}

function renderRealtimeConnectionState(realtimeState) {
  state.realtimeState = realtimeState;
  els.status.dataset.realtime = realtimeState;
  if (realtimeState === "reconnecting") {
    els.statusIcon.title = `${els.statusIcon.title || "NAS 已连接"}，实时通道正在重连`;
  }
  renderDiagnostics();
}

function renderConnectionFromRealtimeState() {
  const onlineAgents = state.agents.filter((agent) => agent.online).length;
  const readyCodex = state.codexWindows.length > 0 ? 1 : 0;
  const input = { nasReachable: true, onlineAgents, readyCodex };
  const connectionStatus = deriveConnectionStatus(input);
  els.status.textContent = connectionStatus.detail;
  setConnectionState(connectionStatus);
  renderConnectionDetails(input);
}

function setSubmitError(message) {
  if (!els.submitError) {
    return;
  }
  els.submitError.hidden = !message;
  els.submitError.textContent = message;
}

function friendlySubmitError(error) {
  const message = extractApiErrorMessage(error);
  if (message.includes("先给这个对话绑定一个电脑窗口")) {
    return "先给这个对话绑定一个电脑窗口，再发送。点顶部“窗口”按钮选择对应的 Codex 窗口。";
  }
  return message || "发送失败，请稍后再试。";
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
  closeWindowPicker();
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
  closeWindowPicker();
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
  state.tasks = mergePendingTasks(payload.tasks ?? [], state.activeConversationId);
  if (payload.conversation) {
    const index = state.conversations.findIndex((conversation) => conversation.id === payload.conversation.id);
    if (index >= 0) {
      state.conversations[index] = payload.conversation;
    } else {
      state.conversations.unshift(payload.conversation);
    }
  }
}

async function loadActiveSessionTasks() {
  const payload = await api("/api/tasks");
  const tasks = payload.tasks ?? [];
  updateConversationTaskStates(tasks);
  return tasks
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
  renderCurrentWindowSwitcher();
  renderRefreshWindowBinding();
  renderApprovals();
  renderActiveSessions();
  renderConversationSidebar();
  renderMessages();
  renderJumpToLatest();
  renderDiagnostics();
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
  const marker = getConversationStatusMarker(conversation.id);
  return `
    <button class="conversation-item ${active ? "active" : ""}" data-conversation-id="${escapeHtml(conversation.id)}" type="button">
      <span class="conversation-item-main"><span>${escapeHtml(conversation.title)}</span>${marker ? `<span class="conversation-status-marker ${escapeHtml(marker.status)}">${escapeHtml(marker.label)}</span>` : ""}</span>
      <time>${escapeHtml(source)} ${formatRelativeTime(conversation.updatedAt)}</time>
    </button>
  `;
}

function updateConversationTaskStates(tasks) {
  const grouped = new Map();
  for (const task of tasks) {
    if (!task.conversationId) continue;
    const group = grouped.get(task.conversationId) ?? [];
    group.push(task);
    grouped.set(task.conversationId, group);
  }
  const statuses = {};
  for (const [conversationId, conversationTasks] of grouped) {
    const active = conversationTasks
      .filter(isActiveTask)
      .sort(compareActiveTasks)[0];
    if (active) {
      statuses[conversationId] = active.status;
      continue;
    }
    const latest = conversationTasks[0];
    if (latest?.status === "failed") {
      statuses[conversationId] = "failed";
    }
  }
  state.conversationTaskStates = statuses;
}

function updateConversationStatusFromTask(task) {
  const active = state.activeTasks
    .filter((item) => item.conversationId === task.conversationId)
    .sort(compareActiveTasks)[0];
  if (active) {
    state.conversationTaskStates[task.conversationId] = active.status;
  } else if (task.status === "failed") {
    state.conversationTaskStates[task.conversationId] = "failed";
  } else {
    delete state.conversationTaskStates[task.conversationId];
  }
}

function getConversationStatusMarker(conversationId) {
  const status = state.conversationTaskStates[conversationId];
  if (status === "waiting_approval") return { status, label: "等授权" };
  if (status === "running") return { status, label: "执行中" };
  if (status === "queued" || status === "cancelling") return { status: "queued", label: "排队" };
  if (status === "failed") return { status, label: "失败" };
  return undefined;
}

function renderDiagnostics() {
  const snapshot = getDiagnosticsSnapshot();
  const rows = [
    ["NAS", snapshot.nas.reachable ? `${snapshot.nas.latencyMs ?? "-"} ms` : "未连接"],
    ["实时消息", describeRealtimeState(snapshot.nas.realtimeState)],
    ["Win11", snapshot.agent?.online ? `${snapshot.agent.id} 在线` : "未上线"],
    ["最近心跳", snapshot.agent?.lastSeenAt ? formatRelativeTime(snapshot.agent.lastSeenAt) : "暂无"],
    ["Codex", snapshot.codex.ready ? "可用" : snapshot.agent?.online ? "恢复中" : "等待电脑"],
    ["当前会话", snapshot.conversation?.id ?? "未选择"],
    ["Codex 对话", snapshot.conversation?.threadId ?? "首次发送后创建"],
    ["待处理权限", String(snapshot.pendingApprovals)],
    ["正在执行", String(snapshot.activeTasks)]
  ];
  if (snapshot.latestError) {
    rows.push(["最近错误", "可在脱敏诊断中查看"]);
  }
  els.diagnosticsSummary.innerHTML = rows
    .map(([label, value]) => `<div class="diagnostics-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

function getDiagnosticsSnapshot() {
  return buildDiagnosticsSnapshot({
    appVersion,
    apiBase,
    realtimeState: state.realtimeState,
    lastEventId: getRealtimeCursor(),
    health: state.health,
    latencyMs: state.latencyMs,
    agents: state.agents,
    codexWindows: state.codexWindows,
    conversation: getActiveConversation(),
    pendingApprovals: state.approvals.length,
    activeTasks: state.activeTasks.length,
    latestError: state.latestError
  });
}

function describeRealtimeState(value) {
  return {
    online: "已连接",
    connecting: "连接中",
    reconnecting: "正在重连",
    syncing: "正在补齐消息",
    stopped: "未启动"
  }[value] ?? "检查中";
}

async function exportDiagnostics() {
  const report = formatSanitizedDiagnostics(getDiagnosticsSnapshot());
  els.exportDiagnostics.disabled = true;
  try {
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(report);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (!copied) {
      const field = document.createElement("textarea");
      field.value = report;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      copied = document.execCommand("copy");
      field.remove();
    }
    if (!copied) {
      throw new Error("clipboard unavailable");
    }
    els.diagnosticsStatus.textContent = "脱敏诊断已复制，可以直接发给我排查。";
  } catch (error) {
    state.latestError = error?.message || String(error);
    els.diagnosticsStatus.textContent = "复制失败，请稍后再试。";
  } finally {
    els.diagnosticsStatus.hidden = false;
    els.exportDiagnostics.disabled = false;
  }
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

function renderRefreshWindowBinding() {
  const conversation = getActiveConversation();
  const current = conversation?.refreshWindowId || "";
  const options = [
    `<option value="">不绑定，多个窗口时自动跳过刷新</option>`,
    ...state.codexWindows.map((window) => {
      const label = `${getWindowDisplayName(window)} · ${window.agentId}`;
      return `<option value="${escapeHtml(window.id)}">${escapeHtml(label)}</option>`;
    })
  ];
  els.refreshWindowBinding.innerHTML = options.join("");
  els.refreshWindowBinding.value = state.codexWindows.some((window) => window.id === current) ? current : "";
  els.refreshWindowBinding.disabled = !conversation || state.codexWindows.length === 0;
  if (!conversation) {
    els.refreshWindowHelp.textContent = "先选择或新建一个会话，再绑定电脑 Codex 窗口。";
  } else if (state.codexWindows.length === 0) {
    els.refreshWindowHelp.textContent = "还没检测到电脑 Codex 窗口，确认 Win11 已打开 Codex。";
  } else if (current && els.refreshWindowBinding.value === current) {
    els.refreshWindowHelp.textContent = "已绑定。这个会话完成后只刷新这个 Codex 窗口。";
  } else if (current) {
    els.refreshWindowHelp.textContent = "原绑定窗口暂时不在线，刷新会先跳过，避免影响其他窗口。";
  } else {
    els.refreshWindowHelp.textContent = "绑定后，这个会话完成时只刷新指定的电脑 Codex 窗口。";
  }
}

function renderCurrentWindowSwitcher() {
  const conversation = getActiveConversation();
  const current = conversation?.refreshWindowId || "";
  const currentWindow = state.codexWindows.find((window) => window.id === current);
  const hasWindows = state.codexWindows.length > 0;
  const disabled = !conversation || !hasWindows;
  const label = getCurrentWindowLabel(conversation, currentWindow, current);

  els.currentWindowToggle.disabled = disabled;
  els.currentWindowToggle.classList.toggle("bound", Boolean(currentWindow));
  els.currentWindowToggle.classList.toggle("offline", Boolean(current && !currentWindow));
  els.currentWindowToggle.setAttribute("aria-expanded", state.windowPickerOpen ? "true" : "false");
  els.currentWindowToggle.title = label;
  els.currentWindowLabel.textContent = getCurrentWindowButtonLabel(conversation, currentWindow, current);

  els.windowPicker.hidden = !state.windowPickerOpen || disabled;
  if (els.windowPicker.hidden) {
    els.windowPicker.innerHTML = "";
    return;
  }

  els.windowPicker.innerHTML = `
    <div class="window-picker-header">
      <strong>发送到哪个电脑窗口</strong>
      <span>${state.codexWindows.length} 个在线</span>
    </div>
    <div class="window-picker-list">
      ${state.codexWindows.map((window) => renderWindowPickerItem(window, current)).join("")}
    </div>
    <button class="window-picker-clear" data-window-bind="" type="button">不绑定窗口</button>
  `;
  els.windowPicker.querySelectorAll("[data-window-bind]").forEach((button) => {
    button.addEventListener("click", () => bindActiveConversationRefreshWindow(button.dataset.windowBind));
  });
  els.windowPicker.querySelectorAll("[data-window-rename]").forEach((button) => {
    button.addEventListener("click", () => renameCodexWindow(button.dataset.windowRename));
  });
}

function getCurrentWindowLabel(conversation, currentWindow, current) {
  if (!conversation) {
    return "未选会话";
  }
  if (currentWindow) {
    return getWindowDisplayName(currentWindow);
  }
  if (current) {
    return "窗口不可用";
  }
  if (state.codexWindows.length === 1) {
    return `可选 ${state.codexWindows[0].processId}`;
  }
  if (state.codexWindows.length > 1) {
    return "选择窗口";
  }
  return "无窗口";
}

function getCurrentWindowButtonLabel(conversation, currentWindow, current) {
  if (!conversation) {
    return "窗口";
  }
  if (current && !currentWindow) {
    return "不可用";
  }
  if (currentWindow) {
    return getWindowButtonShortName(currentWindow);
  }
  return "窗口";
}

function renderWindowPickerItem(window, current) {
  const active = window.id === current;
  const displayName = getWindowDisplayName(window);
  const boundConversation = getWindowBoundConversation(window);
  const title = compactText(window.title || "Codex", 32);
  const boundHint = boundConversation ? `已绑定：${compactText(boundConversation.title || boundConversation.projectId, 24)}` : "未绑定会话";
  const technicalHint = `${window.agentId} · pid ${window.processId} · 窗 ${shortWindowHandle(window)}`;
  return `
    <div class="window-picker-item ${active ? "active" : ""}">
      <button class="window-picker-select" data-window-bind="${escapeHtml(window.id)}" type="button">
        <span class="window-picker-title">${escapeHtml(displayName)}</span>
        <span class="window-picker-meta">${escapeHtml(boundHint)}</span>
        <span class="window-picker-subtitle">${escapeHtml(title)}</span>
        <span class="window-picker-meta">${escapeHtml(technicalHint)}</span>
      </button>
      <button class="window-picker-rename" data-window-rename="${escapeHtml(window.id)}" type="button">备注</button>
    </div>
  `;
}

function getWindowDisplayName(window) {
  const remark = getWindowRemark(window);
  if (remark) {
    return remark;
  }
  const boundConversation = getWindowBoundConversation(window);
  if (boundConversation?.id === state.activeConversationId) {
    return `当前会话 · 窗 ${shortWindowHandle(window)}`;
  }
  if (boundConversation?.title) {
    return compactText(boundConversation.title, 16);
  }
  return `Codex · 窗 ${shortWindowHandle(window)}`;
}

function getWindowButtonShortName(window) {
  const remark = getWindowRemark(window);
  if (remark) {
    return compactText(remark, 5);
  }
  return `窗 ${shortWindowHandle(window)}`;
}

function getWindowBoundConversation(window) {
  return state.conversations.find((conversation) => conversation.refreshWindowId === window.id);
}

function getWindowAlias(windowId) {
  return (state.windowAliases[windowId] || "").trim();
}

function getWindowRemark(window) {
  return (window?.remark || getWindowAlias(window?.id) || "").trim();
}

function loadWindowAliases() {
  try {
    const aliases = JSON.parse(localStorage.getItem(selectionKeys.windowAliases) || "{}");
    return aliases && typeof aliases === "object" && !Array.isArray(aliases) ? aliases : {};
  } catch {
    return {};
  }
}

function saveWindowAliases() {
  localStorage.setItem(selectionKeys.windowAliases, JSON.stringify(state.windowAliases));
}

async function renameCodexWindow(windowId) {
  const codexWindow = state.codexWindows.find((item) => item.id === windowId);
  if (!codexWindow) {
    return;
  }
  const currentName = getWindowRemark(codexWindow);
  const nextName = window.prompt("给这个 Codex 窗口写个备注，例如：openclaw 主窗口", currentName);
  if (nextName === null) {
    return;
  }
  const normalized = nextName.trim().slice(0, 18);
  try {
    const payload = await api("/api/codex-windows/remark", {
      method: "POST",
      body: JSON.stringify({ windowId, remark: normalized })
    });
    state.codexWindows = payload.windows ?? state.codexWindows.map((item) =>
      item.id === windowId ? { ...item, remark: payload.window?.remark } : item
    );
    delete state.windowAliases[windowId];
  } catch {
    if (normalized) {
      state.windowAliases[windowId] = normalized;
    } else {
      delete state.windowAliases[windowId];
    }
  }
  saveWindowAliases();
  renderRefreshWindowBinding();
  renderCurrentWindowSwitcher();
}

function shortWindowHandle(window) {
  const handle = String(window?.handle || window?.id || "");
  return handle.length > 4 ? handle.slice(-4) : handle || "--";
}

async function bindActiveConversationRefreshWindow(selectedRefreshWindowId) {
  const conversation = getActiveConversation();
  if (!conversation) {
    return;
  }
  const refreshWindowId = selectedRefreshWindowId ?? els.refreshWindowBinding.value;
  const payload = await api(`/api/conversations/${encodeURIComponent(conversation.id)}/refresh-window`, {
    method: "POST",
    body: JSON.stringify({ refreshWindowId })
  });
  const index = state.conversations.findIndex((item) => item.id === payload.conversation.id);
  if (index >= 0) {
    state.conversations[index] = payload.conversation;
  }
  state.windowPickerOpen = false;
  if (els.refreshWindowBinding) {
    els.refreshWindowBinding.value = refreshWindowId;
  }
  renderRefreshWindowBinding();
  renderCurrentWindowSwitcher();
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
  closeWindowPicker();
  state.approvalInboxOpen = !state.approvalInboxOpen;
  renderApprovals();
}

function closeApprovalInbox() {
  state.approvalInboxOpen = false;
  renderApprovals();
}

function toggleWindowPicker() {
  if (els.currentWindowToggle.disabled) {
    return;
  }
  state.approvalInboxOpen = false;
  state.windowPickerOpen = !state.windowPickerOpen;
  renderApprovals();
  renderCurrentWindowSwitcher();
}

function closeWindowPicker() {
  if (!state.windowPickerOpen) {
    return;
  }
  state.windowPickerOpen = false;
  renderCurrentWindowSwitcher();
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
  document.querySelectorAll("[data-retry-send]").forEach((button) => {
    button.addEventListener("click", () => retryPendingSend(button.dataset.retrySend));
  });
  finishMessageRender(scrollIntent);
}

function requestMessageScrollToBottom() {
  scrollState.forceBottom = true;
  clearActiveConversationUnread();
}

function markActiveConversationUnread() {
  scrollState.unread = true;
  renderJumpToLatest();
}

function clearActiveConversationUnread() {
  if (!scrollState.unread) {
    return;
  }
  scrollState.unread = false;
  renderJumpToLatest();
}

function renderJumpToLatest() {
  els.jumpToLatest.hidden = !scrollState.unread;
}

function jumpToLatestMessage() {
  clearActiveConversationUnread();
  requestMessageScrollToBottom();
  renderMessages();
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
    scrollState.unread = false;
  } else {
    els.messages.scrollTop = Math.min(intent.previousScrollTop, els.messages.scrollHeight);
  }
  scrollState.activeConversationId = intent.conversationId;
  scrollState.forceBottom = false;
  renderJumpToLatest();
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
    const representedInHistory = isTaskPromptInHistory(task, historyMessages);
    if (!representedInHistory) {
      return true;
    }
    return task.status === "queued" || task.status === "running" || task.status === "waiting_approval" || task.status === "cancelling";
  });
}

function isTaskPromptInHistory(task, historyMessages) {
  const prompt = normalizeComparableMessageText(task.prompt);
  if (!prompt) {
    return false;
  }
  return historyMessages.some((message) => message.role === "user" && normalizeComparableMessageText(message.text) === prompt);
}

function normalizeComparableMessageText(text) {
  return String(text ?? "").trim();
}

function renderSyncedHistory(messages) {
  return messages.length > 0 ? `<p class="history-note">电脑 Codex 最近历史</p>` : "";
}

function renderTimeline(historyMessages, tasks, prefixHtml) {
  const timelineHistoryMessages = dedupeTimelineHistoryMessages(historyMessages);
  const items = [];
  timelineHistoryMessages.forEach((message, index) => {
    items.push({
      at: message.at,
      order: index,
      html: renderHistoryMessage(message)
    });
  });

  tasks.forEach((task, index) => {
    const order = timelineHistoryMessages.length + index * 2;
    if (!isTaskPromptInHistory(task, timelineHistoryMessages)) {
      items.push({
        at: task.createdAt,
        order,
        html: renderUserMessage(task)
      });
    }
    if (task.status !== "sending" && task.status !== "send_failed") {
      items.push({
        at: task.finishedAt || task.updatedAt || task.createdAt,
        order: order + 1,
        html: renderCodexMessage(task)
      });
    }
  });

  const html = items
    .sort(compareTimelineItems)
    .map((item) => item.html)
    .join("");
  return prefixHtml + html;
}

function dedupeTimelineHistoryMessages(messages) {
  const deduped = [];
  messages.forEach((message) => {
    const previous = deduped.at(-1);
    if (isLikelyDuplicateHistoryMessage(previous, message)) {
      return;
    }
    deduped.push(message);
  });
  return deduped;
}

function isLikelyDuplicateHistoryMessage(previous, message) {
  if (!previous || previous.role !== "user" || message?.role !== "user") {
    return false;
  }
  const previousText = normalizeComparableMessageText(previous.text);
  const text = normalizeComparableMessageText(message.text);
  if (!text || previousText !== text) {
    return false;
  }
  const distance = timeDistanceMs(previous.at, message.at);
  return !Number.isFinite(distance) || distance <= 120000;
}

function timeDistanceMs(left, right) {
  const leftTime = Date.parse(left || "");
  const rightTime = Date.parse(right || "");
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return Number.NaN;
  }
  return Math.abs(rightTime - leftTime);
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
  const pendingStatus = task.status === "sending"
    ? `<div class="message-send-state">正在发送...</div>`
    : task.status === "send_failed"
      ? `<div class="message-send-state failed">发送失败 <button data-retry-send="${escapeHtml(task.clientMessageId)}" type="button">重试</button></div>`
      : "";
  return `
    <article class="message user-message">
      <div class="bubble">
        <div class="message-text">${escapeHtml(task.prompt)}</div>
        ${pendingStatus}
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
  state.health = null;
  state.latencyMs = null;
  state.agents = [];
  state.codexWindows = [];
  state.approvals = [];
  state.realtimeState = "stopped";
  els.currentProjectName.textContent = "手机遥控 Codex";
  els.conversationTitle.textContent = "像和 Codex 聊天一样发任务";
  state.windowPickerOpen = false;
  els.currentWindowToggle.disabled = true;
  els.currentWindowToggle.classList.remove("bound", "offline");
  els.currentWindowToggle.setAttribute("aria-expanded", "false");
  els.currentWindowLabel.textContent = "窗口";
  els.windowPicker.hidden = true;
  els.windowPicker.innerHTML = "";
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
  renderDiagnostics();
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
  closeWindowPicker();
  els.sidebar.classList.add("open");
  els.sidebarScrim.hidden = false;
}

function closeSidebar() {
  els.sidebar.classList.remove("open");
  els.sidebarScrim.hidden = true;
}

function openSettings() {
  closeWindowPicker();
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
      throw new Error(extractApiErrorMessage(result.body) || `HTTP ${result.status}`);
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
    throw new Error(extractApiErrorMessage(await response.text()) || `HTTP ${response.status}`);
  }
  return response.json();
}

function extractApiErrorMessage(error) {
  const raw = typeof error === "string" ? error : error?.message || String(error || "");
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // Plain text errors are already usable.
  }
  return raw;
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
