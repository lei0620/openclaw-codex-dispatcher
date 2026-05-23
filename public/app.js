let token = localStorage.getItem("openclawToken") || "";

const selectionKeys = {
  project: "openclawActiveProject",
  conversation: "openclawActiveConversation"
};

const state = {
  projects: [],
  conversations: [],
  tasks: [],
  agents: [],
  activeProjectId: localStorage.getItem(selectionKeys.project) || "",
  activeConversationId: localStorage.getItem(selectionKeys.conversation) || ""
};

const modeLabels = {
  "dry-run": "只测试连接",
  codex: "正式让 Codex 执行"
};

const statusLabels = {
  queued: "排队中",
  running: "执行中",
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
  mode: document.querySelector("#mode"),
  prompt: document.querySelector("#prompt"),
  form: document.querySelector("#chat-form"),
  submit: document.querySelector("#submit"),
  refresh: document.querySelector("#refresh"),
  token: document.querySelector("#token"),
  saveToken: document.querySelector("#save-token"),
  agents: document.querySelector("#agents"),
  messages: document.querySelector("#messages"),
  currentProjectName: document.querySelector("#current-project-name"),
  conversationTitle: document.querySelector("#conversation-title"),
  conversationList: document.querySelector("#conversation-list"),
  newConversation: document.querySelector("#new-conversation"),
  sidebar: document.querySelector("#conversation-sidebar"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarClose: document.querySelector("#sidebar-close"),
  sidebarScrim: document.querySelector("#sidebar-scrim")
};

els.token.value = token;
els.refresh.addEventListener("click", () => refresh());
els.saveToken.addEventListener("click", saveToken);
els.form.addEventListener("submit", submitTask);
els.newConversation.addEventListener("click", () => createNewConversation());
els.sidebarToggle.addEventListener("click", openSidebar);
els.sidebarClose.addEventListener("click", closeSidebar);
els.sidebarScrim.addEventListener("click", closeSidebar);

await refresh();
setInterval(() => refresh(), 5000);

async function refresh() {
  if (!token) {
    els.status.textContent = "请输入访问密码";
    renderEmptyState();
    return;
  }

  try {
    const [projects, conversations, agents] = await Promise.all([
      api("/api/projects"),
      api("/api/conversations"),
      api("/api/agents")
    ]);
    state.projects = projects.projects ?? [];
    state.conversations = conversations.conversations ?? [];
    state.agents = agents.agents ?? [];
    ensureSelection();
    await loadActiveTasks();
    renderAll();

    const online = state.agents.filter((agent) => agent.online).length;
    els.status.textContent = online > 0 ? `${online} 台电脑在线` : "没有电脑在线";
  } catch (error) {
    els.status.textContent = "连接失败，请检查密码或 NAS 服务";
    els.messages.innerHTML = `<div class="empty">连接失败：${escapeHtml(error.message)}</div>`;
  }
}

function saveToken() {
  token = els.token.value.trim();
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
    state.activeProjectId = payload.conversation.projectId;
    state.activeConversationId = payload.conversation.id;
    persistSelection();
    await refresh();
    closeSidebar();
    els.prompt.focus();
  } finally {
    els.newConversation.disabled = false;
  }
}

async function switchProject(projectId) {
  state.activeProjectId = projectId;
  state.activeConversationId = conversationsForProject(projectId)[0]?.id ?? "";
  persistSelection();
  await loadActiveTasks();
  renderAll();
  closeSidebar();
}

async function switchConversation(conversationId) {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    return;
  }
  state.activeProjectId = conversation.projectId;
  state.activeConversationId = conversation.id;
  persistSelection();
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

function renderAll() {
  renderHeader();
  renderModes();
  renderAgents();
  renderConversationSidebar();
  renderMessages();
}

function renderHeader() {
  const project = getActiveProject();
  const conversation = getActiveConversation();
  els.currentProjectName.textContent = project ? project.name : "选择项目";
  els.conversationTitle.textContent = conversation ? conversation.title : "选择一个对话或新建对话";
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
  return `
    <button class="conversation-item ${active ? "active" : ""}" data-conversation-id="${escapeHtml(conversation.id)}" type="button">
      <span>${escapeHtml(conversation.title)}</span>
      <time>${formatRelativeTime(conversation.updatedAt)}</time>
    </button>
  `;
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

function renderMessages() {
  if (!token) {
    renderEmptyState();
    return;
  }
  if (!getActiveProject()) {
    els.messages.innerHTML = `<div class="empty">Win11 还没有把 D:\\aixm 下的项目同步回来，点刷新再看。</div>`;
    return;
  }
  if (!state.activeConversationId) {
    els.messages.innerHTML = `<div class="empty">左侧点“新对话”，或者选择一个已有对话。</div>`;
    return;
  }
  if (state.tasks.length === 0) {
    els.messages.innerHTML = `<div class="empty">这个对话还没有消息。直接在下面输入给 Codex 的话就行。</div>`;
    return;
  }

  els.messages.innerHTML = state.tasks.flatMap((task) => [renderUserMessage(task), renderCodexMessage(task)]).join("");

  document.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", () => cancelTask(button.dataset.cancel));
  });
  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderUserMessage(task) {
  return `
    <article class="message user-message">
      <div class="bubble">
        <div class="message-name">你</div>
        <p>${escapeHtml(task.prompt)}</p>
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
        <div class="task-status-line">${escapeHtml(describeTaskStatus(task))}</div>
        ${renderTaskDetails(task)}
        ${usefulLogs.raw ? `<details class="technical-log"><summary>查看技术日志</summary><pre>${escapeHtml(usefulLogs.raw)}</pre></details>` : ""}
        ${cancellable ? `<button class="danger" data-cancel="${escapeHtml(task.id)}" type="button">取消这次任务</button>` : ""}
      </div>
    </article>
  `;
}

function getAnswerText(task, usefulLogs) {
  if (task.mode === "dry-run") {
    return "";
  }
  return usefulLogs.summary;
}

function describeTaskStatus(task) {
  if (task.status === "queued") {
    return "收到，正在排队，等 Win11 电脑领取。";
  }
  if (task.status === "running") {
    return "Win11 已经开始执行，我会把结果同步回来。";
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
    summary: stdout,
    raw
  };
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
  els.messages.innerHTML = `<div class="empty">保存访问密码后就可以像聊天一样给 Codex 发任务。</div>`;
}

function ensureSelection() {
  if (!state.projects.some((project) => project.id === state.activeProjectId)) {
    state.activeProjectId = state.projects[0]?.id ?? "";
  }

  const conversations = conversationsForProject(state.activeProjectId);
  if (!conversations.some((conversation) => conversation.id === state.activeConversationId)) {
    state.activeConversationId = conversations[0]?.id ?? "";
  }

  persistSelection();
}

function persistSelection() {
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

async function api(url, options = {}) {
  const response = await fetch(url, {
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}
