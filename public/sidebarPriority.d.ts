export interface SidebarProject {
  id: string;
  name?: string;
}

export interface SidebarConversation {
  id: string;
  projectId: string;
  updatedAt?: string;
  title?: string;
}

export interface SidebarTask {
  id: string;
  projectId: string;
  conversationId?: string;
  status?: string;
}

export function deriveRecentProjects<P extends SidebarProject, C extends SidebarConversation>(
  projects: P[],
  conversations: C[],
  limit?: number
): Array<{ project: P; conversation: C }>;

export function deriveRunningConversations<P extends SidebarProject, C extends SidebarConversation, T extends SidebarTask>(
  projects: P[],
  conversations: C[],
  activeTasks: T[]
): Array<{ task: T; project?: P; conversation?: C }>;
