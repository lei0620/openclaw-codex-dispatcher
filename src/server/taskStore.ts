import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentRecord,
  ApprovalRecord,
  ApprovalStatus,
  ConversationRecord,
  CreateTaskInput,
  ProjectConfig,
  SyncedCodexConversation,
  TaskLogStream,
  TaskRecord,
  TaskResult,
  TaskSource
} from "../shared/types.js";

type TaskStoreEvents = "task.created" | "task.updated" | "task.cancelRequested" | "agent.updated" | "approval.resolved";
type TaskStoreControlEvents = "codex.syncRequested" | "codex.synced";

export class TaskStore extends EventEmitter {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly order: string[] = [];
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly conversationOrder: string[] = [];
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly agents = new Map<string, AgentRecord>();
  private readonly agentProjects = new Map<string, ProjectConfig[]>();
  private readonly storagePath?: string;

  constructor(storagePath?: string) {
    super();
    this.storagePath = storagePath;
    this.load();
  }

  createConversation(input: { projectId: string; title?: string }): ConversationRecord {
    const now = new Date().toISOString();
    const conversation: ConversationRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      title: normalizeTitle(input.title) || "新对话",
      createdAt: now,
      updatedAt: now,
      source: "panel"
    };
    this.conversations.set(conversation.id, conversation);
    this.conversationOrder.push(conversation.id);
    this.save();
    return structuredClone(conversation);
  }

  listConversations(projectId?: string, limit?: number): ConversationRecord[] {
    return this.conversationOrder
      .map((id) => this.conversations.get(id))
      .filter((conversation): conversation is ConversationRecord => Boolean(conversation))
      .filter((conversation) => !projectId || conversation.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined)
      .filter((conversation): conversation is ConversationRecord => Boolean(conversation))
      .map((conversation) => structuredClone(conversation));
  }

  getConversation(conversationId: string): ConversationRecord | undefined {
    const conversation = this.conversations.get(conversationId);
    return conversation ? structuredClone(conversation) : undefined;
  }

  upsertCodexConversations(input: SyncedCodexConversation[]): ConversationRecord[] {
    const records: ConversationRecord[] = [];
    for (const item of input) {
      const existingBySession = [...this.conversations.values()].find((conversation) => conversation.codexSessionId === item.sessionId);
      const id = existingBySession?.id ?? codexConversationId(item.sessionId);
      const existing = this.conversations.get(id);
      const updatedAt =
        existing && existing.updatedAt.localeCompare(item.updatedAt) > 0 ? existing.updatedAt : item.updatedAt;
      const record: ConversationRecord = {
        id,
        projectId: item.projectId,
        title: normalizeTitle(item.title) || "Codex 对话",
        createdAt: existing?.createdAt ?? item.updatedAt,
        updatedAt,
        source: "codex",
        codexSessionId: item.sessionId,
        messages: item.messages
      };
      this.conversations.set(id, record);
      if (!this.conversationOrder.includes(id)) {
        this.conversationOrder.push(id);
      }
      records.push(structuredClone(record));
    }
    if (records.length > 0) {
      this.save();
    }
    this.emit("codex.synced");
    return records;
  }

  createTask(input: CreateTaskInput & { mode: string; source?: TaskSource; conversationId?: string }): TaskRecord {
    const now = new Date().toISOString();
    const conversationId = input.conversationId ?? this.createConversation({ projectId: input.projectId, title: input.prompt }).id;
    const conversation = this.conversations.get(conversationId);
    const task: TaskRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      conversationId,
      codexSessionId: conversation?.codexSessionId,
      prompt: input.prompt,
      mode: input.mode,
      source: input.source ?? "api",
      status: "queued",
      createdAt: now,
      updatedAt: now,
      logs: []
    };
    this.tasks.set(task.id, task);
    this.order.push(task.id);
    this.touchConversation(conversationId, input.prompt, now);
    this.save();
    this.emitChange("task.created", task);
    return task;
  }

  listTasks(conversationId?: string): TaskRecord[] {
    return this.order
      .map((id) => this.tasks.get(id))
      .filter((task): task is TaskRecord => Boolean(task))
      .filter((task) => !conversationId || task.conversationId === conversationId)
      .map((task) => structuredClone(task));
  }

  getTask(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  assignNextTask(agentId: string): TaskRecord | undefined {
    const task = this.order
      .map((id) => this.tasks.get(id))
      .find((candidate): candidate is TaskRecord => {
        if (!candidate) {
          return false;
        }
        return candidate.status === "queued";
      });
    if (!task) {
      return undefined;
    }
    const now = new Date().toISOString();
    task.status = "running";
    task.agentId = agentId;
    task.startedAt = now;
    task.updatedAt = now;
    this.save();
    this.emitChange("task.updated", task);
    return structuredClone(task);
  }

  appendLog(taskId: string, stream: TaskLogStream, text: string): TaskRecord {
    const task = this.requireTask(taskId);
    task.logs.push({ at: new Date().toISOString(), stream, text });
    task.updatedAt = new Date().toISOString();
    this.save();
    this.emitChange("task.updated", task);
    return task;
  }

  requestApproval(approval: ApprovalRecord): TaskRecord {
    const task = this.requireTask(approval.taskId);
    const record: ApprovalRecord = {
      ...approval,
      agentId: approval.agentId ?? task.agentId,
      projectId: task.projectId,
      status: "pending"
    };
    task.status = "waiting_approval";
    task.pendingApproval = record;
    task.updatedAt = new Date().toISOString();
    this.approvals.set(record.id, record);
    this.save();
    this.emitChange("task.updated", task);
    return task;
  }

  completeTask(taskId: string, result: TaskResult): TaskRecord {
    const task = this.requireTask(taskId);
    task.status = "completed";
    task.result = result;
    if (result.codexSessionId) {
      task.codexSessionId = result.codexSessionId;
      this.bindConversationToCodexSession(task.conversationId, result.codexSessionId);
    }
    task.finishedAt = new Date().toISOString();
    task.updatedAt = task.finishedAt;
    this.save();
    this.emitChange("task.updated", task);
    return task;
  }

  failTask(taskId: string, error: string): TaskRecord {
    const task = this.requireTask(taskId);
    task.status = "failed";
    task.error = error;
    task.finishedAt = new Date().toISOString();
    task.updatedAt = task.finishedAt;
    this.save();
    this.emitChange("task.updated", task);
    return task;
  }

  requestCancel(taskId: string): TaskRecord {
    const task = this.requireTask(taskId);
    if (task.status === "queued") {
      task.status = "cancelled";
      task.finishedAt = new Date().toISOString();
    } else if (task.status === "running") {
      task.status = "cancelling";
      task.cancelRequestedAt = new Date().toISOString();
      this.emitChange("task.cancelRequested", task);
    }
    task.updatedAt = new Date().toISOString();
    this.save();
    this.emitChange("task.updated", task);
    return task;
  }

  markCancelled(taskId: string, reason = "cancelled by request"): TaskRecord {
    const task = this.requireTask(taskId);
    task.status = "cancelled";
    task.error = reason;
    task.finishedAt = new Date().toISOString();
    task.updatedAt = task.finishedAt;
    this.save();
    this.emitChange("task.updated", task);
    return task;
  }

  listApprovals(status?: ApprovalStatus): ApprovalRecord[] {
    return [...this.approvals.values()]
      .filter((approval) => !status || approval.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((approval) => structuredClone(approval));
  }

  resolveApproval(approvalId: string, decision: Exclude<ApprovalStatus, "pending">): ApprovalRecord {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      throw new Error(`approval not found: ${approvalId}`);
    }
    if (approval.status !== "pending") {
      return structuredClone(approval);
    }
    approval.status = decision;
    approval.respondedAt = new Date().toISOString();
    const task = this.tasks.get(approval.taskId);
    if (task?.pendingApproval?.id === approval.id) {
      task.pendingApproval = undefined;
      task.status = task.status === "waiting_approval" ? "running" : task.status;
      task.updatedAt = approval.respondedAt;
      this.emitChange("task.updated", task);
    }
    this.save();
    this.emitChange("approval.resolved", approval);
    return structuredClone(approval);
  }

  upsertAgent(agentId: string): AgentRecord {
    const now = new Date().toISOString();
    const agent = this.agents.get(agentId) ?? { id: agentId, online: true, connectedAt: now, lastSeenAt: now };
    agent.online = true;
    agent.lastSeenAt = now;
    this.agents.set(agentId, agent);
    this.emitChange("agent.updated", agent);
    return agent;
  }

  markAgentOffline(agentId: string): AgentRecord | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return undefined;
    }
    agent.online = false;
    agent.lastSeenAt = new Date().toISOString();
    this.emitChange("agent.updated", agent);
    return agent;
  }

  listAgents(): AgentRecord[] {
    return [...this.agents.values()];
  }

  setAgentProjects(agentId: string, projects: ProjectConfig[]): ProjectConfig[] {
    this.agentProjects.set(agentId, structuredClone(projects));
    return this.listProjects();
  }

  listProjects(configuredProjects: ProjectConfig[] = []): ProjectConfig[] {
    const projects = new Map<string, ProjectConfig>();
    for (const project of configuredProjects) {
      projects.set(project.id, project);
    }
    for (const agentProjects of this.agentProjects.values()) {
      for (const project of agentProjects) {
        projects.set(project.id, project);
      }
    }
    return [...projects.values()];
  }

  onStoreEvent(event: TaskStoreEvents, listener: (record: TaskRecord | AgentRecord | ApprovalRecord) => void): void {
    this.on(event, listener);
  }

  onControlEvent(event: TaskStoreControlEvents, listener: () => void): void {
    this.on(event, listener);
  }

  requestCodexSessionSync(): void {
    this.emit("codex.syncRequested");
  }

  waitForCodexSessionSync(timeoutMs = 2500): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.off("codex.synced", onSynced);
        resolve();
      };
      const onSynced = () => done();
      const timer = setTimeout(done, timeoutMs);
      this.once("codex.synced", onSynced);
    });
  }

  private requireTask(taskId: string): TaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`task not found: ${taskId}`);
    }
    return task;
  }

  private emitChange(event: TaskStoreEvents, record: TaskRecord | AgentRecord | ApprovalRecord): void {
    this.emit(event, structuredClone(record));
  }

  private touchConversation(conversationId: string, prompt: string, updatedAt: string): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return;
    }
    if (conversation.source !== "codex" && conversation.title === "新对话") {
      conversation.title = prompt.slice(0, 32);
    }
    conversation.updatedAt = updatedAt;
  }

  private bindConversationToCodexSession(conversationId: string | undefined, codexSessionId: string): void {
    if (!conversationId) {
      return;
    }
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return;
    }
    conversation.source = "codex";
    conversation.codexSessionId = codexSessionId;
  }

  private load(): void {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) {
      return;
    }
    const raw = JSON.parse(fs.readFileSync(this.storagePath, "utf8")) as {
      conversations?: ConversationRecord[];
      tasks?: TaskRecord[];
    };
    for (const conversation of raw.conversations ?? []) {
      this.conversations.set(conversation.id, conversation);
      this.conversationOrder.push(conversation.id);
    }
    for (const task of raw.tasks ?? []) {
      if (task.status === "waiting_approval") {
        task.status = "failed";
        task.error = "服务重启时仍在等待授权，请重新发送。";
        task.pendingApproval = undefined;
      }
      this.tasks.set(task.id, task);
      this.order.push(task.id);
    }
  }

  private save(): void {
    if (!this.storagePath) {
      return;
    }
    fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
    fs.writeFileSync(
      this.storagePath,
      JSON.stringify(
        {
          conversations: this.listConversations().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          tasks: this.listTasks()
        },
        null,
        2
      ),
      "utf8"
    );
  }
}

function normalizeTitle(title: string | undefined): string {
  return (title ?? "").trim().slice(0, 64);
}

function codexConversationId(sessionId: string): string {
  return `codex:${sessionId}`;
}
