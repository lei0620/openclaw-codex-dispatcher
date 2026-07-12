export function deriveRecentProjects(projects, conversations, limit = 3) {
  const normalizedLimit = Math.max(0, limit);
  if (normalizedLimit === 0) {
    return [];
  }
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const seen = new Set();
  const result = [];

  for (const conversation of [...conversations].sort(compareConversationUpdatedAt)) {
    if (seen.has(conversation.projectId)) {
      continue;
    }
    const project = projectsById.get(conversation.projectId);
    if (!project) {
      continue;
    }
    seen.add(conversation.projectId);
    result.push({ project, conversation });
    if (result.length >= normalizedLimit) {
      break;
    }
  }

  return result;
}

export function deriveRunningConversations(projects, conversations, activeTasks) {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));

  return activeTasks.map((task) => ({
    task,
    project: projectsById.get(task.projectId),
    conversation: conversationsById.get(task.conversationId)
  }));
}

export function deriveAttentionConversations(projects, conversations, activeTasks, unreadTasks) {
  const active = deriveRunningConversations(projects, conversations, activeTasks)
    .map((item) => ({ ...item, unread: false }));
  const occupiedConversations = new Set(active.map((item) => item.task.conversationId).filter(Boolean));
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const unread = [];

  for (const task of [...unreadTasks].sort(compareTaskUpdatedAt)) {
    if (!task.conversationId || occupiedConversations.has(task.conversationId)) continue;
    occupiedConversations.add(task.conversationId);
    unread.push({
      task,
      project: projectsById.get(task.projectId),
      conversation: conversationsById.get(task.conversationId),
      unread: true
    });
  }

  return [...active, ...unread];
}

function compareConversationUpdatedAt(a, b) {
  return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
}

function compareTaskUpdatedAt(a, b) {
  const left = String(a.finishedAt ?? a.updatedAt ?? a.createdAt ?? "");
  const right = String(b.finishedAt ?? b.updatedAt ?? b.createdAt ?? "");
  return right.localeCompare(left);
}
