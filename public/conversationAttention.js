const activeStatuses = new Set(["queued", "running", "waiting_approval", "cancelling"]);

export function deriveDesktopActivityTasks(conversations, taskBackedActivities = []) {
  const taskBackedConversationIds = new Set(
    taskBackedActivities
      .filter((task) => activeStatuses.has(task?.status))
      .map((task) => task.conversationId)
      .filter(Boolean)
  );

  return conversations.flatMap((conversation) => {
    const status = conversation?.activityStatus;
    const activityUpdatedAt = conversation?.activityUpdatedAt;
    if (!conversation?.id || !conversation.projectId || !activityUpdatedAt) return [];
    if (status === "running") {
      if (taskBackedConversationIds.has(conversation.id)) return [];
      return [desktopTask(conversation, "running", activityUpdatedAt)];
    }
    if (status === "completed") {
      return [desktopTask(conversation, "completed", activityUpdatedAt)];
    }
    return [];
  });
}

function desktopTask(conversation, status, activityUpdatedAt) {
  return {
    id: `desktop:${conversation.id}:${status}:${activityUpdatedAt}`,
    projectId: conversation.projectId,
    conversationId: conversation.id,
    prompt: conversation.title || "Codex 对话",
    source: "desktop",
    status,
    createdAt: activityUpdatedAt,
    updatedAt: activityUpdatedAt,
    ...(status === "completed" ? { finishedAt: activityUpdatedAt } : {})
  };
}
