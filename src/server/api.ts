import express from "express";
import { z } from "zod";
import type { CodexDesktopWindow, ConversationRecord, DispatcherConfig } from "../shared/types.js";
import { resolveProject } from "../shared/pathPolicy.js";
import type { TaskStore } from "./taskStore.js";

interface ApiDeps {
  config: DispatcherConfig;
  store: TaskStore;
}

const createTaskSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  prompt: z.string().min(1),
  mode: z.string().min(1).optional(),
  source: z.enum(["panel", "wechat", "openclaw", "api"]).default("api"),
  clientMessageId: z.string().trim().min(8).max(128).optional()
});

const createConversationSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(64).optional()
});

const wechatTaskSchema = z.object({
  text: z.string().min(1),
  projectId: z.string().min(1).optional()
});

const bindRefreshWindowSchema = z.object({
  refreshWindowId: z.string().optional().default("")
});

const renameCodexWindowSchema = z.object({
  windowId: z.string().min(1),
  remark: z.string().max(40).optional().default("")
});

const simulateApprovalSchema = z.object({
  projectId: z.string().min(1),
  message: z.string().min(1).max(2000).optional()
});

export function createApiRouter({ config, store }: ApiDeps): express.Router {
  const router = express.Router();
  router.use(requireDispatcherToken(config.auth.dispatcherToken));

  router.get("/health", (_req, res) => {
    const agents = store.listAgents();
    res.json({
      ok: true,
      agents,
      queued: store.listTasks().filter((task) => task.status === "queued").length,
      services: {
        nas: { reachable: true },
        agents: { online: agents.filter((agent) => agent.online).length },
        codex: { ready: agents.filter((agent) => agent.online && agent.codex?.ready).length }
      }
    });
  });

  router.get("/projects", (_req, res) => {
    res.json({ projects: store.listProjects() });
  });

  router.get("/events", (req, res) => {
    const rawAfter = typeof req.query.after === "string" ? req.query.after : "0";
    const afterEventId = Number.parseInt(rawAfter, 10);
    if (!Number.isInteger(afterEventId) || afterEventId < 0) {
      res.status(400).json({ error: "after must be a non-negative event id" });
      return;
    }
    res.json(store.getMobileEventWindow(afterEventId));
  });

  router.get("/conversations", (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const source = typeof req.query.source === "string" ? req.query.source : undefined;
    const rawLimit = typeof req.query.limit === "string" ? req.query.limit : undefined;
    const limit = Number.parseInt(rawLimit ?? "", 10);
    const conversations = store.listConversations(projectId)
      .filter((conversation) => source !== "codex" || Boolean(conversation.codexSessionId))
      .slice(0, Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined);
    res.json({ conversations });
  });

  router.post("/conversations", (req, res) => {
    const body = createConversationSchema.parse(req.body);
    resolveProject(store.listProjects(config.projects), body.projectId);
    const conversation = store.createConversation({ projectId: body.projectId, title: body.title });
    res.status(201).json({ conversation });
  });

  router.post("/conversations/sync", async (_req, res) => {
    store.requestCodexSessionSync();
    await store.waitForCodexSessionSync();
    res.json({ ok: true, conversations: store.listConversations() });
  });

  router.get("/codex-windows", (_req, res) => {
    res.json({ windows: store.listCodexWindows() });
  });

  router.post("/codex-windows/remark", (req, res) => {
    const body = renameCodexWindowSchema.parse(req.body);
    try {
      const window = store.renameCodexWindow(body.windowId, body.remark);
      res.json({ window, windows: store.listCodexWindows() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "codex window remark update failed";
      res.status(message.includes("not found") ? 404 : 400).json({ error: message });
    }
  });

  router.get("/conversations/:id/tasks", (req, res) => {
    const conversation = store.getConversation(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "conversation not found" });
      return;
    }
    res.json({ conversation, tasks: store.listTasks(req.params.id) });
  });

  router.post("/conversations/:id/refresh-window", (req, res) => {
    const body = bindRefreshWindowSchema.parse(req.body);
    try {
      const conversation = store.bindConversationRefreshWindow(req.params.id, body.refreshWindowId);
      res.json({ conversation });
    } catch (error) {
      const message = error instanceof Error ? error.message : "conversation refresh window update failed";
      res.status(message.includes("not found") ? 404 : 400).json({ error: message });
    }
  });

  router.get("/agents", (_req, res) => {
    res.json({ agents: store.listAgents() });
  });

  router.get("/approvals", (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ approvals: store.listApprovals(status === "pending" || status === "approved" || status === "denied" ? status : undefined) });
  });

  router.post("/approvals/simulate", (req, res) => {
    const body = simulateApprovalSchema.parse(req.body);
    resolveProject(store.listProjects(config.projects), body.projectId);
    const approval = store.createSimulatedApproval({
      projectId: body.projectId,
      message:
        body.message ??
        "模拟权限测试：Codex 想运行一条需要你确认的命令。\n\n命令：echo hello\n\n这是测试卡片，批准或拒绝都不会真正执行命令。"
    });
    res.status(201).json({ approval });
  });

  router.post("/approvals/:id/approve", (req, res) => {
    try {
      const approval = store.resolveApproval(req.params.id, "approved");
      res.json({ approval });
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : "approval not found" });
    }
  });

  router.post("/approvals/:id/deny", (req, res) => {
    try {
      const approval = store.resolveApproval(req.params.id, "denied");
      res.json({ approval });
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : "approval not found" });
    }
  });

  router.get("/tasks", (_req, res) => {
    res.json({ tasks: store.listTasks().reverse() });
  });

  router.post("/tasks", (req, res) => {
    const body = createTaskSchema.parse(req.body);
    const project = resolveProject(store.listProjects(config.projects), body.projectId, body.mode);
    const mode = body.mode ?? project.defaultMode;
    const existingTask = body.clientMessageId
      ? store.getTaskByClientMessageId(body.clientMessageId)
      : undefined;
    if (existingTask) {
      if (
        existingTask.projectId !== body.projectId ||
        (body.conversationId !== undefined && existingTask.conversationId !== body.conversationId) ||
        existingTask.prompt !== body.prompt ||
        existingTask.mode !== mode ||
        existingTask.source !== body.source
      ) {
        res.status(409).json({ error: "clientMessageId is already used by a different message" });
        return;
      }
      res.json({ task: existingTask, deduplicated: true });
      return;
    }
    let conversation: ConversationRecord | undefined;
    if (body.conversationId) {
      conversation = store.getConversation(body.conversationId);
      if (!conversation || conversation.projectId !== body.projectId) {
        res.status(400).json({ error: "conversation does not belong to project" });
        return;
      }
    }
    const windowBindingError = getWindowBindingError(config, store.listCodexWindows(), conversation, mode);
    if (windowBindingError) {
      res.status(409).json({ error: windowBindingError });
      return;
    }
    const task = store.createTask({ ...body, mode });
    res.status(201).json({ task });
  });

  router.get("/tasks/:id", (req, res) => {
    const task = store.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: "task not found" });
      return;
    }
    res.json({ task });
  });

  router.post("/tasks/:id/cancel", (req, res) => {
    try {
      const task = store.requestCancel(req.params.id);
      res.json({ task });
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : "task not found" });
    }
  });

  router.post("/chat/wechat", (req, res) => {
    const body = wechatTaskSchema.parse(req.body);
    const projects = store.listProjects(config.projects);
    const parsed = parseWechatCommand(body.text, body.projectId ?? projects[0].id);
    const project = resolveProject(projects, parsed.projectId);
    const task = store.createTask({
      projectId: parsed.projectId,
      prompt: parsed.prompt,
      mode: project.defaultMode,
      source: "wechat"
    });
    res.status(201).json({ task });
  });

  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues.map((issue) => issue.message).join("; ") });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "request failed" });
  });

  return router;
}

function getWindowBindingError(
  config: DispatcherConfig,
  windows: CodexDesktopWindow[],
  conversation: ConversationRecord | undefined,
  mode: string
): string | undefined {
  const desktopRefreshNeedsTarget = Boolean(config.codexAppServer.refreshDesktopAfterTurn);
  if (mode !== "codex" || (!config.desktopInput.enabled && !desktopRefreshNeedsTarget) || !conversation) {
    return undefined;
  }
  if (windows.length <= 1 || hasResolvableWindowBinding(conversation.refreshWindowId, windows)) {
    return undefined;
  }
  return "当前电脑打开了多个 Codex 窗口，请先给这个对话绑定一个电脑窗口，再发送，避免发到错误窗口。";
}

function hasResolvableWindowBinding(refreshWindowId: string | undefined, windows: CodexDesktopWindow[]): boolean {
  const normalized = (refreshWindowId ?? "").trim();
  if (!normalized) {
    return false;
  }
  if (windows.some((window) => window.id === normalized)) {
    return true;
  }
  const pidMatch = normalized.match(/:pid:(\d+)$/);
  if (!pidMatch) {
    return false;
  }
  return windows.filter((window) => String(window.processId) === pidMatch[1]).length === 1;
}

function requireDispatcherToken(token: string): express.RequestHandler {
  return (req, res, next) => {
    const auth = req.header("authorization");
    const bearer = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;
    const headerToken = req.header("x-openclaw-token");
    if (bearer === token || headerToken === token) {
      next();
      return;
    }
    res.status(401).json({ error: "missing or invalid dispatcher token" });
  };
}

function parseWechatCommand(text: string, defaultProjectId: string): { projectId: string; prompt: string } {
  const trimmed = text.trim();
  const separator = trimmed.indexOf(":");
  if (separator > 0) {
    return {
      projectId: trimmed.slice(0, separator).trim(),
      prompt: trimmed.slice(separator + 1).trim()
    };
  }
  return { projectId: defaultProjectId, prompt: trimmed };
}
