import express from "express";
import { z } from "zod";
import type { DispatcherConfig } from "../shared/types.js";
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
  source: z.enum(["panel", "wechat", "openclaw", "api"]).default("api")
});

const createConversationSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(64).optional()
});

const wechatTaskSchema = z.object({
  text: z.string().min(1),
  projectId: z.string().min(1).optional()
});

export function createApiRouter({ config, store }: ApiDeps): express.Router {
  const router = express.Router();
  router.use(requireDispatcherToken(config.auth.dispatcherToken));

  router.get("/health", (_req, res) => {
    res.json({ ok: true, agents: store.listAgents(), queued: store.listTasks().filter((task) => task.status === "queued").length });
  });

  router.get("/projects", (_req, res) => {
    res.json({ projects: store.listProjects(config.projects) });
  });

  router.get("/conversations", (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    res.json({ conversations: store.listConversations(projectId) });
  });

  router.post("/conversations", (req, res) => {
    const body = createConversationSchema.parse(req.body);
    resolveProject(store.listProjects(config.projects), body.projectId);
    const conversation = store.createConversation({ projectId: body.projectId, title: body.title });
    res.status(201).json({ conversation });
  });

  router.get("/conversations/:id/tasks", (req, res) => {
    const conversation = store.getConversation(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "conversation not found" });
      return;
    }
    res.json({ conversation, tasks: store.listTasks(req.params.id) });
  });

  router.get("/agents", (_req, res) => {
    res.json({ agents: store.listAgents() });
  });

  router.get("/tasks", (_req, res) => {
    res.json({ tasks: store.listTasks().reverse() });
  });

  router.post("/tasks", (req, res) => {
    const body = createTaskSchema.parse(req.body);
    const project = resolveProject(store.listProjects(config.projects), body.projectId, body.mode);
    if (body.conversationId) {
      const conversation = store.getConversation(body.conversationId);
      if (!conversation || conversation.projectId !== body.projectId) {
        res.status(400).json({ error: "conversation does not belong to project" });
        return;
      }
    }
    const mode = body.mode ?? project.defaultMode;
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
