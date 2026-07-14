const activeStatuses = new Set(["queued", "running", "waiting_approval", "cancelling"]);

export function applyMobileEvent(state, event) {
  if (!event || !event.type) return state;

  if (event.type === "task.created" || event.type === "task.updated") {
    const task = event.payload?.task;
    if (!task?.id) return state;
    const belongsToActiveConversation = task.conversationId === state.activeConversationId;
    const alreadyVisible = state.tasks.some((item) => sameTask(item, task));
    if (belongsToActiveConversation || alreadyVisible) {
      state.tasks = upsertTask(state.tasks, task);
    }
    state.activeTasks = activeStatuses.has(task.status)
      ? upsertTask(state.activeTasks, task)
      : removeTask(state.activeTasks, task);
    removePendingSend(state, task.clientMessageId);
    return state;
  }

  if (event.type === "task.log") {
    const log = event.payload?.log;
    if (!event.taskId || !log) return state;
    state.tasks = appendLog(state.tasks, event.taskId, log);
    state.activeTasks = appendLog(state.activeTasks, event.taskId, log);
    return state;
  }

  if (event.type === "approval.requested") {
    const approval = event.payload?.approval;
    if (approval?.id) state.approvals = upsertById(state.approvals, approval);
    return state;
  }

  if (event.type === "approval.resolved") {
    const approval = event.payload?.approval;
    if (approval?.id) state.approvals = state.approvals.filter((item) => item.id !== approval.id);
    return state;
  }

  if (event.type === "agent.updated") {
    const agent = event.payload?.agent;
    if (agent?.id) state.agents = upsertById(state.agents, agent);
    return state;
  }

  if (event.type === "codex.windows.updated") {
    state.codexWindows = Array.isArray(event.payload?.windows) ? event.payload.windows : state.codexWindows;
    return state;
  }

  if (event.type === "projects.updated") {
    state.projects = Array.isArray(event.payload?.projects) ? event.payload.projects : state.projects;
    return state;
  }

  if (event.type === "conversation.created" || event.type === "conversation.updated") {
    const conversation = event.payload?.conversation;
    if (conversation?.id) state.conversations = upsertById(state.conversations, conversation);
  }
  if (event.type === "conversation.deleted") {
    const conversationId = event.payload?.conversationId ?? event.conversationId;
    if (conversationId) {
      state.conversations = state.conversations.filter((conversation) => conversation.id !== conversationId);
      if (state.activeConversationId === conversationId) state.activeConversationId = "";
    }
  }
  return state;
}

function upsertTask(tasks, incoming) {
  const existing = tasks.find((task) => sameTask(task, incoming));
  const mergedLogs = mergeLogs(existing?.logs ?? [], incoming.logs ?? []);
  const merged = { ...existing, ...incoming, logs: mergedLogs };
  return [...tasks.filter((task) => !sameTask(task, incoming)), merged];
}

function removeTask(tasks, incoming) {
  return tasks.filter((task) => !sameTask(task, incoming));
}

function sameTask(left, right) {
  return left.id === right.id || Boolean(
    left.clientMessageId && right.clientMessageId && left.clientMessageId === right.clientMessageId
  );
}

function appendLog(tasks, taskId, log) {
  return tasks.map((task) => {
    if (task.id !== taskId) return task;
    return { ...task, logs: mergeLogs(task.logs ?? [], [log]) };
  });
}

function mergeLogs(current, incoming) {
  const logs = [];
  const keys = new Set();
  for (const log of [...current, ...incoming]) {
    const key = `${log.at ?? ""}\u0000${log.stream ?? ""}\u0000${log.text ?? ""}`;
    if (keys.has(key)) continue;
    keys.add(key);
    logs.push(log);
  }
  return logs;
}

function upsertById(items, incoming) {
  const existing = items.find((item) => item.id === incoming.id);
  return [...items.filter((item) => item.id !== incoming.id), { ...existing, ...incoming }];
}

function removePendingSend(state, clientMessageId) {
  if (!clientMessageId || !state.pendingSends) return;
  delete state.pendingSends[clientMessageId];
}
