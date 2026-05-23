import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentRecord,
  ConversationRecord,
  CreateTaskInput,
  ProjectConfig,
  TaskLogStream,
  TaskRecord,
  TaskResult,
  TaskSource
} from "../shared/types.js";

type TaskStoreEvents = "task.created" | "task.updated" | "task.cancelRequested" | "agent.updated";

export class TaskStore extends EventEmitter {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly order: string[] = [];
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly conversationOrder: string[] = [];
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
      updatedAt: now
    };
    this.conversations.set(conversation.id, conversation);
    this.conversationOrder.push(conversation.id);
    this.save();
    return structuredClone(conversation);
  }

  listConversations(projectId?: string): ConversationRecord[] {
    return this.conversationOrder
      .map((id) => this.conversations.get(id))
      .filter((conversation): conversation is ConversationRecord => Boolean(conversation))
      .filter((conversation) => !projectId || conversation.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((conversation) => structuredClone(conversation));
  }

  getConversation(conversationId: string): ConversationRecord | undefined {
    const conversation = this.conversations.get(conversationId);
    return conversation ? structuredClone(conversation) : undefined;
  }

  createTask(input: CreateTaskInput & { mode: string; source?: TaskSource; conversationId?: string }): TaskRecord {
    const now = new Date().toISOString();
    const conversationId = input.conversationId ?? this.createConversation({ projectId: input.projectId, title: input.prompt }).id;
    const task: TaskRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      conversationId,
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

  completeTask(taskId: string, result: TaskResult): TaskRecord {
    const task = this.requireTask(taskId);
    task.status = "completed";
    task.result = result;
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

  onStoreEvent(event: TaskStoreEvents, listener: (record: TaskRecord | AgentRecord) => void): void {
    this.on(event, listener);
  }

  private requireTask(taskId: string): TaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`task not found: ${taskId}`);
    }
    return task;
  }

  private emitChange(event: TaskStoreEvents, record: TaskRecord | AgentRecord): void {
    this.emit(event, structuredClone(record));
  }

  private touchConversation(conversationId: string, prompt: string, updatedAt: string): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return;
    }
    if (conversation.title === "新对话") {
      conversation.title = prompt.slice(0, 32);
    }
    conversation.updatedAt = updatedAt;
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
