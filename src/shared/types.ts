export type TaskStatus = "queued" | "running" | "waiting_approval" | "cancelling" | "cancelled" | "completed" | "failed";

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

export interface CodexAppServerConfig {
  enabled: boolean;
  url: string;
  command?: string;
  startupTimeoutMs: number;
  requestTimeoutMs: number;
  turnTimeoutMs: number;
  supervisorIntervalMs?: number;
  heartbeatIntervalMs?: number;
  refreshDesktopAfterTurn?: boolean;
  refreshScriptPath?: string;
  refreshWindowTitlePattern?: string;
  refreshTimeoutMs?: number;
}

export type CodexServicePhase = "disabled" | "starting" | "ready" | "recovering" | "error";

export interface CodexServiceStatus {
  phase: CodexServicePhase;
  ready: boolean;
  checkedAt: string;
  endpoint: string;
  error?: string;
}

export interface DesktopInputConfig {
  enabled: boolean;
  allowUnsafeForegroundRouting?: boolean;
  scriptPath: string;
  clickYOffset: number;
  windowTitlePattern: string;
  responseTimeoutMs: number;
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
  codexAppServer: CodexAppServerConfig;
  desktopInput: DesktopInputConfig;
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
  codexSessionId?: string;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  conversationId?: string;
  codexSessionId?: string;
  refreshWindowId?: string;
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
  pendingApproval?: ApprovalRecord;
  result?: TaskResult;
  error?: string;
}

export interface ConversationRecord {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  source?: "panel" | "codex";
  codexSessionId?: string;
  refreshWindowId?: string;
  messages?: ConversationMessage[];
}

export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
  at: string;
}

export interface SyncedCodexConversation {
  projectId: string;
  sessionId: string;
  title: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

export type ApprovalStatus = "pending" | "approved" | "denied";

export interface ApprovalRecord {
  id: string;
  taskId: string;
  agentId?: string;
  projectId: string;
  message: string;
  status: ApprovalStatus;
  createdAt: string;
  respondedAt?: string;
}

export interface AgentRecord {
  id: string;
  online: boolean;
  connectedAt: string;
  lastSeenAt: string;
  codex?: CodexServiceStatus;
}

export interface CodexDesktopWindow {
  id: string;
  agentId: string;
  handle: string;
  processId: number;
  title: string;
  remark?: string;
  startedAt?: string;
  updatedAt: string;
}

export type AgentClientMessage =
  | { type: "agent.hello"; agentId: string; token: string }
  | { type: "agent.heartbeat"; sentAt: string; codex: CodexServiceStatus }
  | { type: "agent.projects"; projects: ProjectConfig[] }
  | { type: "agent.codexConversations"; conversations: SyncedCodexConversation[] }
  | { type: "agent.codexWindows"; windows: CodexDesktopWindow[] }
  | { type: "task.approval.requested"; approval: ApprovalRecord }
  | { type: "task.log"; taskId: string; stream: TaskLogStream; text: string }
  | { type: "task.result"; taskId: string; result: TaskResult }
  | { type: "task.failed"; taskId: string; error: string }
  | { type: "task.cancelled"; taskId: string; reason?: string };

export type DispatcherServerMessage =
  | { type: "agent.accepted"; agentId: string }
  | { type: "agent.syncCodexSessions" }
  | { type: "task.approval.resolved"; approvalId: string; taskId: string; decision: Exclude<ApprovalStatus, "pending"> }
  | { type: "task.assigned"; task: TaskRecord; project: ProjectConfig; codex: CodexCommandConfig }
  | { type: "task.cancelled"; taskId: string }
  | { type: "error"; message: string };
