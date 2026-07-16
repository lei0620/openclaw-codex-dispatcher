export interface ConversationActivity {
  id: string;
  projectId: string;
  title?: string;
  activityStatus?: "running" | "completed" | "idle";
  activityUpdatedAt?: string;
}

export interface AttentionTask {
  id: string;
  projectId: string;
  conversationId: string;
  prompt: string;
  source: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export function deriveDesktopActivityTasks(
  conversations: ConversationActivity[],
  taskBackedActivities?: Array<{ conversationId?: string; status?: string }>
): AttentionTask[];
