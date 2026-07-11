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

function compareConversationUpdatedAt(a, b) {
  return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
}
