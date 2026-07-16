import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentRecord,
  ApprovalRecord,
  ApprovalStatus,
  CodexDesktopWindow,
  CodexServiceStatus,
  ConversationMessage,
  ConversationRecord,
  CreateTaskInput,
  MobileEvent,
  MobileEventType,
  MobileEventWindow,
  ProjectConfig,
  SyncedCodexConversation,
  TaskLogStream,
  TaskRecord,
  TaskResult,
  TaskStatus,
  TaskSource
} from "../shared/types.js";

type TaskStoreEvents = "task.created" | "task.updated" | "task.cancelRequested" | "agent.updated" | "approval.resolved";
type TaskStoreControlEvents = "codex.syncRequested" | "codex.synced";

interface TaskStoreOptions {
  mobileEventLimit?: number;
}

export class TaskStore extends EventEmitter {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly tasksByClientMessageId = new Map<string, string>();
  private readonly order: string[] = [];
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly conversationOrder: string[] = [];
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly agents = new Map<string, AgentRecord>();
  private readonly agentProjects = new Map<string, ProjectConfig[]>();
  private readonly codexWindows = new Map<string, CodexDesktopWindow>();
  private readonly codexWindowRemarks = new Map<string, string>();
  private readonly storagePath?: string;
  private readonly mobileEventStoragePath?: string;
  private readonly mobileEventLimit: number;
  private readonly mobileEvents: MobileEvent[] = [];
  private readonly recoveredTaskIds: string[] = [];
  private nextMobileEventId = 1;

  constructor(storagePath?: string, options: TaskStoreOptions = {}) {
    super();
    this.storagePath = storagePath;
    this.mobileEventStoragePath = storagePath ? `${storagePath}.events.jsonl` : undefined;
    this.mobileEventLimit = Math.max(1, options.mobileEventLimit ?? 500);
    this.load();
    if (this.deduplicateStoredCodexConversations()) {
      this.save();
    }
    this.loadMobileEvents();
    for (const taskId of this.recoveredTaskIds) {
      const task = this.tasks.get(taskId);
      if (task) {
        this.publishTaskUpdated(task);
      }
    }
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
    this.publishMobileEvent("conversation.created", { conversation }, { conversationId: conversation.id });
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

  upsertCodexConversations(input: SyncedCodexConversation[], syncedProjectIds?: string[]): ConversationRecord[] {
    const records: ConversationRecord[] = [];
    const changedRecords: ConversationRecord[] = [];
    const conversations = coalesceSyncedConversations(input);
    for (const item of conversations) {
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
        refreshWindowId: existing?.refreshWindowId,
        messages: item.messages,
        activityStatus: item.activityStatus,
        activityUpdatedAt: item.activityUpdatedAt,
        desktopActive: item.desktopActive ?? false,
        desktopReadAt: latestTimestamp(existing?.desktopReadAt, item.desktopReadAt)
      };
      this.conversations.set(id, record);
      if (!this.conversationOrder.includes(id)) {
        this.conversationOrder.push(id);
      }
      records.push(structuredClone(record));
      if (!existing || JSON.stringify(existing) !== JSON.stringify(record)) {
        changedRecords.push(structuredClone(record));
      }
    }
    const coveredProjectIds = new Set((syncedProjectIds ?? []).filter(Boolean));
    const incomingSessionIds = new Set(conversations.map((conversation) => conversation.sessionId));
    const conversationIdsWithTasks = new Set(
      this.order
        .map((taskId) => this.tasks.get(taskId)?.conversationId)
        .filter((conversationId): conversationId is string => Boolean(conversationId))
    );
    const deletedRecords: ConversationRecord[] = [];
    if (coveredProjectIds.size > 0) {
      for (const conversation of this.conversations.values()) {
        if (
          conversation.source !== "codex"
          || !coveredProjectIds.has(conversation.projectId)
          || !conversation.codexSessionId
          || incomingSessionIds.has(conversation.codexSessionId)
          || conversationIdsWithTasks.has(conversation.id)
        ) {
          continue;
        }
        this.conversations.delete(conversation.id);
        deletedRecords.push(structuredClone(conversation));
      }
      if (deletedRecords.length > 0) {
        const deletedIds = new Set(deletedRecords.map((conversation) => conversation.id));
        const remainingOrder = this.conversationOrder.filter((id) => !deletedIds.has(id));
        this.conversationOrder.splice(0, this.conversationOrder.length, ...remainingOrder);
      }
    }
    if (changedRecords.length > 0 || deletedRecords.length > 0) {
      this.save();
    }
    this.emit("codex.synced");
    for (const conversation of changedRecords) {
      this.publishMobileEvent("conversation.updated", { conversation }, { conversationId: conversation.id });
    }
    for (const conversation of deletedRecords) {
      this.publishMobileEvent(
        "conversation.deleted",
        { conversationId: conversation.id },
        { conversationId: conversation.id }
      );
    }
    return records;
  }

  createTask(input: CreateTaskInput & { mode: string; source?: TaskSource; conversationId?: string }): TaskRecord {
    const clientMessageId = normalizeClientMessageId(input.clientMessageId);
    if (clientMessageId) {
      const existing = this.getTaskByClientMessageId(clientMessageId);
      if (existing) {
        return existing;
      }
    }
    const now = new Date().toISOString();
    const conversationId = input.conversationId ?? this.createConversation({ projectId: input.projectId, title: input.prompt }).id;
    const conversation = this.conversations.get(conversationId);
    const refreshWindowId = this.resolveConversationRefreshWindow(conversation);
    if (conversation && refreshWindowId && !conversation.refreshWindowId) {
      conversation.refreshWindowId = refreshWindowId;
    }
    const task: TaskRecord = {
      id: randomUUID(),
      clientMessageId,
      projectId: input.projectId,
      conversationId,
      codexSessionId: conversation?.codexSessionId,
      refreshWindowId,
      prompt: input.prompt,
      mode: input.mode,
      source: input.source ?? "api",
      status: "queued",
      createdAt: now,
      updatedAt: now,
      logs: []
    };
    this.tasks.set(task.id, task);
    if (clientMessageId) {
      this.tasksByClientMessageId.set(clientMessageId, task.id);
    }
    this.order.push(task.id);
    this.touchConversation(conversationId, input.prompt, now);
    this.save();
    this.emitChange("task.created", task);
    this.publishMobileEvent("task.created", { task: toRealtimeTask(task) }, { conversationId, taskId: task.id });
    return structuredClone(task);
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

  getTaskByClientMessageId(clientMessageId: string): TaskRecord | undefined {
    const taskId = this.tasksByClientMessageId.get(normalizeClientMessageId(clientMessageId) ?? "");
    const task = taskId ? this.tasks.get(taskId) : undefined;
    return task ? structuredClone(task) : undefined;
  }

  getLatestMobileEventId(): number {
    return this.nextMobileEventId - 1;
  }

  getMobileEventWindow(afterEventId: number): MobileEventWindow {
    const latestEventId = this.getLatestMobileEventId();
    if (!Number.isInteger(afterEventId) || afterEventId < 0 || afterEventId > latestEventId) {
      return { events: [], latestEventId, resetRequired: true };
    }
    const oldestEventId = this.mobileEvents[0]?.eventId;
    if (oldestEventId !== undefined && afterEventId < oldestEventId - 1) {
      return { events: [], latestEventId, resetRequired: true };
    }
    return {
      events: this.mobileEvents
        .filter((event) => event.eventId > afterEventId)
        .map((event) => structuredClone(event)),
      latestEventId,
      resetRequired: false
    };
  }

  onMobileEvent(listener: (event: MobileEvent) => void): void {
    this.on("mobile.event", listener);
  }

  offMobileEvent(listener: (event: MobileEvent) => void): void {
    this.off("mobile.event", listener);
  }

  assignNextTask(agentId: string): TaskRecord | undefined {
    const activeSlots = this.getActiveSlotKeys(agentId);
    const task = this.order
      .map((id) => this.tasks.get(id))
      .find((candidate): candidate is TaskRecord => {
        if (!candidate) {
          return false;
        }
        return candidate.status === "queued" && !activeSlots.has(getTaskSlotKey(candidate));
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
    this.publishTaskUpdated(task);
    return structuredClone(task);
  }

  appendLog(taskId: string, stream: TaskLogStream, text: string): TaskRecord {
    const task = this.requireTask(taskId);
    task.logs.push({ at: new Date().toISOString(), stream, text });
    task.updatedAt = new Date().toISOString();
    this.save();
    this.emitChange("task.updated", task);
    this.publishMobileEvent(
      "task.log",
      { log: structuredClone(task.logs.at(-1)) },
      { conversationId: task.conversationId, taskId: task.id }
    );
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
    this.publishTaskUpdated(task);
    this.publishMobileEvent(
      "approval.requested",
      { approval: record },
      { conversationId: task.conversationId, taskId: task.id }
    );
    return task;
  }

  createSimulatedApproval(input: { projectId: string; message: string }): ApprovalRecord {
    const now = new Date().toISOString();
    const record: ApprovalRecord = {
      id: randomUUID(),
      taskId: `simulated-${randomUUID()}`,
      projectId: input.projectId,
      message: input.message,
      status: "pending",
      createdAt: now
    };
    this.approvals.set(record.id, record);
    this.save();
    this.publishMobileEvent("approval.requested", { approval: record }, { taskId: record.taskId });
    return structuredClone(record);
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
    this.publishTaskUpdated(task);
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
    this.publishTaskUpdated(task);
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
    this.publishTaskUpdated(task);
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
    this.publishTaskUpdated(task);
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
      this.publishTaskUpdated(task);
    }
    this.save();
    this.emitChange("approval.resolved", approval);
    this.publishMobileEvent(
      "approval.resolved",
      { approval },
      { conversationId: task?.conversationId, taskId: approval.taskId }
    );
    return structuredClone(approval);
  }

  upsertAgent(agentId: string): AgentRecord {
    const now = new Date().toISOString();
    const previous = this.agents.get(agentId);
    const agent = previous ?? { id: agentId, online: true, connectedAt: now, lastSeenAt: now };
    agent.online = true;
    agent.lastSeenAt = now;
    this.agents.set(agentId, agent);
    this.emitChange("agent.updated", agent);
    if (!previous || !previous.online) {
      this.publishMobileEvent("agent.updated", { agent });
    }
    return agent;
  }

  heartbeatAgent(
    agentId: string,
    codex: CodexServiceStatus,
    at = new Date().toISOString()
  ): void {
    const current = this.agents.get(agentId);
    const previousVisibleState = current ? agentVisibleState(current) : undefined;
    const base = current ?? {
      id: agentId,
      online: true,
      connectedAt: at,
      lastSeenAt: at
    };
    const agent = { ...base, online: true, lastSeenAt: at, codex };
    this.agents.set(agentId, agent);
    this.emitChange("agent.updated", agent);
    if (!previousVisibleState || previousVisibleState !== agentVisibleState(agent)) {
      this.publishMobileEvent("agent.updated", { agent });
    }
  }

  markStaleAgentsOffline(cutoffMs: number, nowMs = Date.now()): void {
    for (const [id, agent] of this.agents.entries()) {
      const lastSeenMs = Date.parse(agent.lastSeenAt);
      if (!Number.isFinite(lastSeenMs) || nowMs - lastSeenMs <= cutoffMs || !agent.online) {
        continue;
      }
      const offline = { ...agent, online: false };
      this.agents.set(id, offline);
      this.clearAgentCodexWindows(id);
      this.emitChange("agent.updated", offline);
      this.publishMobileEvent("agent.updated", { agent: offline });
      this.publishMobileEvent("codex.windows.updated", { windows: this.listCodexWindows() });
    }
  }

  isAgentReady(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    return Boolean(agent?.online && agent.codex?.ready);
  }

  markAgentOffline(agentId: string): AgentRecord | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return undefined;
    }
    agent.online = false;
    agent.lastSeenAt = new Date().toISOString();
    this.clearAgentCodexWindows(agentId);
    this.emitChange("agent.updated", agent);
    this.publishMobileEvent("agent.updated", { agent });
    this.publishMobileEvent("codex.windows.updated", { windows: this.listCodexWindows() });
    return agent;
  }

  stopActiveTasksForAgent(agentId: string, reason = "电脑代理已离线，任务已中断，请重新发送。"): TaskRecord[] {
    const stopped: TaskRecord[] = [];
    const finishedAt = new Date().toISOString();
    for (const task of this.tasks.values()) {
      if (task.agentId !== agentId) {
        continue;
      }
      if (!["running", "waiting_approval", "cancelling"].includes(task.status)) {
        continue;
      }
      if (task.status === "cancelling") {
        task.status = "cancelled";
        task.error = "cancelled by agent disconnect";
      } else {
        task.status = "failed";
        task.error = reason;
      }
      task.pendingApproval = undefined;
      task.finishedAt = finishedAt;
      task.updatedAt = finishedAt;
      stopped.push(structuredClone(task));
      this.emitChange("task.updated", task);
      this.publishTaskUpdated(task);
    }
    if (stopped.length > 0) {
      this.save();
    }
    return stopped;
  }

  listAgents(): AgentRecord[] {
    return [...this.agents.values()];
  }

  setAgentProjects(agentId: string, projects: ProjectConfig[]): ProjectConfig[] {
    const previousSignature = JSON.stringify(this.agentProjects.get(agentId) ?? []);
    this.agentProjects.set(agentId, structuredClone(projects));
    const allProjects = this.listProjects();
    if (JSON.stringify(projects) !== previousSignature) {
      this.publishMobileEvent("projects.updated", { projects: allProjects });
    }
    return allProjects;
  }

  setAgentCodexWindows(agentId: string, windows: CodexDesktopWindow[]): CodexDesktopWindow[] {
    const previousSignature = codexWindowListSignature(this.listCodexWindows());
    for (const [id, window] of this.codexWindows.entries()) {
      if (window.agentId === agentId) {
        this.codexWindows.delete(id);
      }
    }
    const now = new Date().toISOString();
    for (const window of windows) {
      const id = window.id || `${agentId}:${window.handle}`;
      const remark = this.codexWindowRemarks.get(id);
      const normalized: CodexDesktopWindow = {
        ...window,
        id,
        agentId,
        handle: String(window.handle),
        remark: remark || undefined,
        updatedAt: window.updatedAt || now
      };
      this.codexWindows.set(normalized.id, normalized);
    }
    const allWindows = this.listCodexWindows();
    if (codexWindowListSignature(allWindows) !== previousSignature) {
      this.publishMobileEvent("codex.windows.updated", { windows: allWindows });
    }
    return allWindows;
  }

  listCodexWindows(): CodexDesktopWindow[] {
    const onlineAgentIds = new Set([...this.agents.values()].filter((agent) => agent.online).map((agent) => agent.id));
    return [...this.codexWindows.values()]
      .filter((window) => onlineAgentIds.has(window.agentId))
      .sort((a, b) => {
        const agentCompare = a.agentId.localeCompare(b.agentId);
        if (agentCompare !== 0) {
          return agentCompare;
        }
        return String(b.startedAt || b.updatedAt).localeCompare(String(a.startedAt || a.updatedAt));
      })
      .map((window) => structuredClone(window));
  }

  private clearAgentCodexWindows(agentId: string): void {
    for (const [id, window] of this.codexWindows.entries()) {
      if (window.agentId === agentId) {
        this.codexWindows.delete(id);
      }
    }
  }

  private getOnlyOnlineCodexWindowId(): string | undefined {
    const windows = this.listCodexWindows();
    return windows.length === 1 ? windows[0].id : undefined;
  }

  private resolveConversationRefreshWindow(conversation: ConversationRecord | undefined): string | undefined {
    const current = conversation?.refreshWindowId;
    if (!current) {
      return this.getOnlyOnlineCodexWindowId();
    }
    if (this.codexWindows.has(current)) {
      return current;
    }
    const pidMatch = current.match(/:pid:(\d+)$/);
    if (pidMatch) {
      const matches = this.listCodexWindows().filter((window) => String(window.processId) === pidMatch[1]);
      if (matches.length === 1) {
        conversation.refreshWindowId = matches[0].id;
        return matches[0].id;
      }
    }
    conversation.refreshWindowId = undefined;
    return this.getOnlyOnlineCodexWindowId();
  }

  private getActiveSlotKeys(agentId: string): Set<string> {
    const activeStatuses = new Set<TaskStatus>(["running", "waiting_approval", "cancelling"]);
    return new Set(
      [...this.tasks.values()]
        .filter((task) => task.agentId === agentId && activeStatuses.has(task.status))
        .map((task) => getTaskSlotKey(task))
    );
  }

  bindConversationRefreshWindow(conversationId: string, refreshWindowId?: string): ConversationRecord {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`conversation not found: ${conversationId}`);
    }
    const normalized = (refreshWindowId ?? "").trim();
    if (normalized && !this.codexWindows.has(normalized)) {
      throw new Error(`codex window not found: ${normalized}`);
    }
    conversation.refreshWindowId = normalized || undefined;
    conversation.updatedAt = new Date().toISOString();
    this.save();
    this.publishMobileEvent("conversation.updated", { conversation }, { conversationId: conversation.id });
    return structuredClone(conversation);
  }

  renameCodexWindow(windowId: string, remark: string): CodexDesktopWindow {
    const window = this.codexWindows.get(windowId);
    if (!window) {
      throw new Error(`codex window not found: ${windowId}`);
    }
    const normalized = normalizeWindowRemark(remark);
    if (normalized) {
      this.codexWindowRemarks.set(windowId, normalized);
      window.remark = normalized;
    } else {
      this.codexWindowRemarks.delete(windowId);
      window.remark = undefined;
    }
    window.updatedAt = new Date().toISOString();
    this.save();
    this.publishMobileEvent("codex.windows.updated", { windows: this.listCodexWindows() });
    return structuredClone(window);
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

  private publishTaskUpdated(task: TaskRecord): void {
    this.publishMobileEvent(
      "task.updated",
      { task: toRealtimeTask(task) },
      { conversationId: task.conversationId, taskId: task.id }
    );
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
      windowRemarks?: Record<string, string>;
    };
    for (const [windowId, remark] of Object.entries(raw.windowRemarks ?? {})) {
      const normalized = normalizeWindowRemark(remark);
      if (windowId && normalized) {
        this.codexWindowRemarks.set(windowId, normalized);
      }
    }
    for (const conversation of raw.conversations ?? []) {
      this.conversations.set(conversation.id, conversation);
      this.conversationOrder.push(conversation.id);
    }
    let recoveredInterruptedTask = false;
    for (const task of raw.tasks ?? []) {
      if (["running", "waiting_approval", "cancelling"].includes(task.status)) {
        const recoveredAt = new Date().toISOString();
        if (task.status === "cancelling") {
          task.status = "cancelled";
          task.error = "NAS 服务重启时任务正在取消。";
        } else if (task.status === "waiting_approval") {
          task.status = "failed";
          task.error = "NAS 服务重启时仍在等待授权，请重新发送。";
        } else {
          task.status = "failed";
          task.error = "NAS 服务重启，原执行进程已中断，请重新发送。";
        }
        task.pendingApproval = undefined;
        task.finishedAt = recoveredAt;
        task.updatedAt = recoveredAt;
        this.recoveredTaskIds.push(task.id);
        recoveredInterruptedTask = true;
      }
      this.tasks.set(task.id, task);
      const clientMessageId = normalizeClientMessageId(task.clientMessageId);
      if (clientMessageId) {
        task.clientMessageId = clientMessageId;
        this.tasksByClientMessageId.set(clientMessageId, task.id);
      }
      this.order.push(task.id);
    }
    if (recoveredInterruptedTask) {
      this.save();
    }
  }

  private loadMobileEvents(): void {
    if (!this.mobileEventStoragePath || !fs.existsSync(this.mobileEventStoragePath)) {
      return;
    }
    const events = fs
      .readFileSync(this.mobileEventStoragePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const event = JSON.parse(line) as MobileEvent;
          return Number.isInteger(event.eventId) && event.eventId > 0 ? [event] : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => a.eventId - b.eventId)
      .slice(-this.mobileEventLimit);
    this.mobileEvents.push(...events);
    this.nextMobileEventId = (events.at(-1)?.eventId ?? 0) + 1;
    if (events.length > 0) {
      this.rewriteMobileEventFile();
    }
  }

  private publishMobileEvent(
    type: MobileEventType,
    payload: Record<string, unknown>,
    refs: { conversationId?: string; taskId?: string } = {}
  ): MobileEvent {
    const event: MobileEvent = {
      eventId: this.nextMobileEventId++,
      type,
      occurredAt: new Date().toISOString(),
      ...refs,
      payload: structuredClone(payload)
    };
    this.mobileEvents.push(event);
    if (this.mobileEvents.length > this.mobileEventLimit) {
      this.mobileEvents.splice(0, this.mobileEvents.length - this.mobileEventLimit);
      this.rewriteMobileEventFile();
    } else if (this.mobileEventStoragePath) {
      fs.mkdirSync(path.dirname(this.mobileEventStoragePath), { recursive: true });
      fs.appendFileSync(this.mobileEventStoragePath, `${JSON.stringify(event)}\n`, "utf8");
    }
    this.emit("mobile.event", structuredClone(event));
    return event;
  }

  private rewriteMobileEventFile(): void {
    if (!this.mobileEventStoragePath) {
      return;
    }
    fs.mkdirSync(path.dirname(this.mobileEventStoragePath), { recursive: true });
    const content = this.mobileEvents.map((event) => JSON.stringify(event)).join("\n");
    fs.writeFileSync(this.mobileEventStoragePath, content ? `${content}\n` : "", "utf8");
  }

  private deduplicateStoredCodexConversations(): boolean {
    const bySession = new Map<string, ConversationRecord[]>();
    for (const conversation of this.conversations.values()) {
      const sessionId = conversation.codexSessionId;
      if (!sessionId) {
        continue;
      }
      const group = bySession.get(sessionId) ?? [];
      group.push(conversation);
      bySession.set(sessionId, group);
    }

    let changed = false;
    for (const [sessionId, group] of bySession) {
      if (group.length < 2) {
        continue;
      }
      const taskCount = (conversationId: string) => this.listTasks(conversationId).length;
      const primary = [...group].sort((left, right) => {
        const taskDifference = taskCount(right.id) - taskCount(left.id);
        if (taskDifference !== 0) return taskDifference;
        const bindingDifference = Number(Boolean(right.refreshWindowId)) - Number(Boolean(left.refreshWindowId));
        if (bindingDifference !== 0) return bindingDifference;
        const leftCanonical = left.id === codexConversationId(sessionId);
        const rightCanonical = right.id === codexConversationId(sessionId);
        if (leftCanonical !== rightCanonical) return leftCanonical ? 1 : -1;
        return right.updatedAt.localeCompare(left.updatedAt);
      })[0];
      const latest = [...group].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      const messages = group.reduce(
        (current, conversation) => mergeSyncedConversationMessages(current, conversation.messages ?? []),
        [] as ConversationMessage[]
      );
      const merged: ConversationRecord = {
        ...primary,
        title: latest.title,
        createdAt: [...group].sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0].createdAt,
        updatedAt: latest.updatedAt,
        refreshWindowId: primary.refreshWindowId ?? group.find((conversation) => conversation.refreshWindowId)?.refreshWindowId,
        messages
      };
      const duplicateIds = new Set(group.filter((conversation) => conversation.id !== primary.id).map((conversation) => conversation.id));
      for (const task of this.tasks.values()) {
        if (task.conversationId && duplicateIds.has(task.conversationId)) {
          task.conversationId = primary.id;
        }
      }
      for (const duplicateId of duplicateIds) {
        this.conversations.delete(duplicateId);
      }
      this.conversations.set(primary.id, merged);
      const nextOrder = this.conversationOrder.filter((id) => !duplicateIds.has(id));
      this.conversationOrder.splice(0, this.conversationOrder.length, ...nextOrder);
      changed = true;
    }
    return changed;
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
          tasks: this.listTasks(),
          windowRemarks: Object.fromEntries(this.codexWindowRemarks)
        },
        null,
        2
      ),
      "utf8"
    );
  }
}

function coalesceSyncedConversations(input: SyncedCodexConversation[]): SyncedCodexConversation[] {
  const conversations = new Map<string, SyncedCodexConversation>();
  for (const item of input) {
    const key = `${item.projectId}\u0000${item.sessionId}`;
    const existing = conversations.get(key);
    if (!existing) {
      conversations.set(key, structuredClone(item));
      continue;
    }
    const incomingIsNewer = item.updatedAt.localeCompare(existing.updatedAt) >= 0;
    conversations.set(key, {
      projectId: item.projectId,
      sessionId: item.sessionId,
      title: incomingIsNewer ? item.title : existing.title,
      updatedAt: incomingIsNewer ? item.updatedAt : existing.updatedAt,
      messages: mergeSyncedConversationMessages(existing.messages, item.messages),
      activityStatus: latestConversationActivity(existing, item)?.activityStatus,
      activityUpdatedAt: latestConversationActivity(existing, item)?.activityUpdatedAt,
      desktopActive: incomingIsNewer ? item.desktopActive : existing.desktopActive,
      desktopReadAt: latestDesktopReadState(existing, item)?.desktopReadAt
    });
  }
  return [...conversations.values()];
}

function latestDesktopReadState(
  current: SyncedCodexConversation,
  incoming: SyncedCodexConversation
): SyncedCodexConversation | undefined {
  return [current, incoming]
    .filter((conversation) => conversation.desktopReadAt)
    .sort((left, right) => String(right.desktopReadAt).localeCompare(String(left.desktopReadAt)))[0];
}

function latestTimestamp(current?: string, incoming?: string): string | undefined {
  if (!current) return incoming;
  if (!incoming) return current;
  return current.localeCompare(incoming) >= 0 ? current : incoming;
}

function latestConversationActivity(
  current: SyncedCodexConversation,
  incoming: SyncedCodexConversation
): SyncedCodexConversation | undefined {
  return [current, incoming]
    .filter((conversation) => conversation.activityUpdatedAt)
    .sort((left, right) => String(right.activityUpdatedAt).localeCompare(String(left.activityUpdatedAt)))[0];
}

function mergeSyncedConversationMessages(
  current: ConversationMessage[],
  incoming: ConversationMessage[]
): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  const keys = new Set<string>();
  const ordered = [...current, ...incoming].sort((left, right) => {
    const leftTime = Date.parse(left.at || "");
    const rightTime = Date.parse(right.at || "");
    return Number.isFinite(leftTime) && Number.isFinite(rightTime) ? leftTime - rightTime : 0;
  });
  for (const message of ordered) {
    const key = `${message.role}\u0000${message.phase ?? ""}\u0000${message.at}\u0000${message.text}`;
    if (keys.has(key)) {
      continue;
    }
    keys.add(key);
    messages.push(message);
  }
  return messages.slice(-18);
}

function normalizeTitle(title: string | undefined): string {
  return (title ?? "").trim().slice(0, 64);
}

function normalizeWindowRemark(remark: string | undefined): string {
  return (remark ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
}

function normalizeClientMessageId(clientMessageId: string | undefined): string | undefined {
  const normalized = (clientMessageId ?? "").trim().slice(0, 128);
  return normalized || undefined;
}

function toRealtimeTask(task: TaskRecord): TaskRecord {
  return { ...structuredClone(task), logs: [] };
}

function agentVisibleState(agent: AgentRecord): string {
  return JSON.stringify({
    online: agent.online,
    phase: agent.codex?.phase,
    ready: agent.codex?.ready,
    error: agent.codex?.error
  });
}

function codexWindowListSignature(windows: CodexDesktopWindow[]): string {
  return JSON.stringify(
    windows.map((window) => ({
      id: window.id,
      agentId: window.agentId,
      handle: window.handle,
      processId: window.processId,
      title: window.title,
      remark: window.remark,
      startedAt: window.startedAt
    }))
  );
}

function codexConversationId(sessionId: string): string {
  return `codex:${sessionId}`;
}

function getTaskSlotKey(task: TaskRecord): string {
  return task.refreshWindowId || task.conversationId || "default";
}
