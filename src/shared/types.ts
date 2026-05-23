export type TaskStatus = "queued" | "running" | "cancelling" | "cancelled" | "completed" | "failed";

export type TaskSource = "panel" | "wechat" | "openclaw" | "api";

export type TaskLogStream = "stdout" | "stderr" | "system";

export interface ServerConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
}

export interface AuthConfig {
  dispatcherToken: string;
  agentToken: string;
}

export interface ProjectConfig {
  id: string;
  name: string;
  path: string;
  defaultMode: string;
  allowedModes: string[];
  notify: boolean;
}

export interface CodexCommandConfig {
  command: string;
  args: string[];
  promptStdin: boolean;
}

export interface ProjectDiscoveryConfig {
  enabled: boolean;
  roots: string[];
  exclude: string[];
  defaultMode: string;
  allowedModes: string[];
  notify: boolean;
}

export interface DispatcherConfig {
  server: ServerConfig;
  auth: AuthConfig;
  projects: ProjectConfig[];
  projectDiscovery: ProjectDiscoveryConfig;
  codex: CodexCommandConfig;
}

export interface CreateTaskInput {
  projectId: string;
  prompt: string;
  mode?: string;
  source?: TaskSource;
  conversationId?: string;
}

export interface TaskLog {
  at: string;
  stream: TaskLogStream;
  text: string;
}

export interface TaskResult {
  exitCode: number;
  summary: string;
  diffSummary: string;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  conversationId?: string;
  prompt: string;
  mode: string;
  source: TaskSource;
  status: TaskStatus;
  agentId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancelRequestedAt?: string;
  logs: TaskLog[];
  result?: TaskResult;
  error?: string;
}

export interface ConversationRecord {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRecord {
  id: string;
  online: boolean;
  connectedAt: string;
  lastSeenAt: string;
}

export type AgentClientMessage =
  | { type: "agent.hello"; agentId: string; token: string }
  | { type: "agent.projects"; projects: ProjectConfig[] }
  | { type: "task.log"; taskId: string; stream: TaskLogStream; text: string }
  | { type: "task.result"; taskId: string; result: TaskResult }
  | { type: "task.failed"; taskId: string; error: string }
  | { type: "task.cancelled"; taskId: string; reason?: string };

export type DispatcherServerMessage =
  | { type: "agent.accepted"; agentId: string }
  | { type: "task.assigned"; task: TaskRecord; project: ProjectConfig; codex: CodexCommandConfig }
  | { type: "task.cancelled"; taskId: string }
  | { type: "error"; message: string };
