const terminalStatuses = new Set(["completed", "failed"]);
const defaultStorageKey = "openclawUnreadTasksV1";

export function createUnreadTaskStore(storage, options = {}) {
  const storageKey = options.storageKey ?? defaultStorageKey;
  const now = options.now ?? (() => new Date().toISOString());
  const persisted = loadState(storage, storageKey);
  const state = persisted ?? { baselineAt: now(), readTaskIds: [] };
  const readTaskIds = new Set(state.readTaskIds);
  if (!persisted) persist();

  function reconcile(tasks, context = {}) {
    if (!context.activeConversationVisible || !context.activeConversationId) return;
    markConversationRead(context.activeConversationId, tasks);
  }

  function markConversationRead(conversationId, tasks) {
    let changed = false;
    for (const task of tasks) {
      if (task.conversationId !== conversationId || !isUnreadCandidate(task, state.baselineAt)) continue;
      if (!readTaskIds.has(task.id)) {
        readTaskIds.add(task.id);
        changed = true;
      }
    }
    if (changed) persist();
  }

  function getUnreadTasks(tasks) {
    return tasks
      .filter((task) => isUnreadCandidate(task, state.baselineAt) && !readTaskIds.has(task.id))
      .sort((left, right) => taskTime(right).localeCompare(taskTime(left)));
  }

  function persist() {
    const ids = [...readTaskIds].slice(-1000);
    storage.setItem(storageKey, JSON.stringify({ baselineAt: state.baselineAt, readTaskIds: ids }));
  }

  return { reconcile, markConversationRead, getUnreadTasks };
}

function isUnreadCandidate(task, baselineAt) {
  return Boolean(task?.id && task?.conversationId && terminalStatuses.has(task.status) && taskTime(task) > baselineAt);
}

function taskTime(task) {
  return String(task.finishedAt || task.updatedAt || task.createdAt || "");
}

function loadState(storage, storageKey) {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) || "null");
    if (!parsed || typeof parsed.baselineAt !== "string" || !Array.isArray(parsed.readTaskIds)) return null;
    return {
      baselineAt: parsed.baselineAt,
      readTaskIds: parsed.readTaskIds.filter((id) => typeof id === "string")
    };
  } catch {
    return null;
  }
}
