import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DispatcherConfig } from "./types.js";

const projectPathSchema = z.string().min(1).refine(isAcceptedAbsolutePath, {
  message: "project path must be an absolute Windows, UNC, or POSIX path"
});

const configSchema = z.object({
  server: z.object({
    host: z.string().default("0.0.0.0"),
    port: z.coerce.number().int().positive().default(4318),
    publicBaseUrl: z.string().url().optional()
  }),
  auth: z.object({
    dispatcherToken: z.string().min(8),
    agentToken: z.string().min(8)
  }),
  projects: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
        name: z.string().min(1),
        path: projectPathSchema,
        defaultMode: z.string().min(1).default("codex"),
        allowedModes: z.array(z.string().min(1)).optional(),
        notify: z.boolean().default(true)
      })
    )
    .min(1),
  projectDiscovery: z
    .object({
      enabled: z.boolean().default(false),
      roots: z.array(projectPathSchema).default(["D:/aixm"]),
      exclude: z.array(z.string().min(1)).default(["beifen"]),
      defaultMode: z.string().min(1).default("codex"),
      allowedModes: z.array(z.string().min(1)).default(["codex", "dry-run"]),
      notify: z.boolean().default(true)
    })
    .default({
      enabled: false,
      roots: ["D:/aixm"],
      exclude: ["beifen"],
      defaultMode: "codex",
      allowedModes: ["codex", "dry-run"],
      notify: true
    }),
  codex: z.object({
    command: z.string().min(1).default("codex"),
    args: z.array(z.string()).default(["exec", "--cd", "{{projectPath}}", "{{prompt}}"]),
    promptStdin: z.boolean().default(false)
  })
});

export function loadDispatcherConfig(configPath = process.env.OPENCLAW_CONFIG ?? "config/dispatcher.config.json"): DispatcherConfig {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  const parsed = configSchema.parse(raw);
  const seen = new Set<string>();
  const projects = parsed.projects.map((project) => {
    if (seen.has(project.id)) {
      throw new Error(`duplicate project id: ${project.id}`);
    }
    seen.add(project.id);
    const allowedModes = project.allowedModes?.length ? project.allowedModes : [project.defaultMode];
    return { ...project, allowedModes };
  });
  const host = process.env.HOST ?? parsed.server.host;
  const port = Number(process.env.PORT ?? parsed.server.port);
  return {
    server: {
      host,
      port,
      publicBaseUrl:
        process.env.OPENCLAW_PUBLIC_BASE_URL ?? parsed.server.publicBaseUrl ?? `http://${host}:${port}`
    },
    auth: {
      dispatcherToken: process.env.OPENCLAW_DISPATCHER_TOKEN ?? parsed.auth.dispatcherToken,
      agentToken: process.env.OPENCLAW_AGENT_TOKEN ?? parsed.auth.agentToken
    },
    projects,
    projectDiscovery: parsed.projectDiscovery,
    codex: {
      command: process.env.CODEX_COMMAND ?? parsed.codex.command,
      args: process.env.CODEX_ARGS ? JSON.parse(process.env.CODEX_ARGS) : parsed.codex.args,
      promptStdin: process.env.CODEX_PROMPT_STDIN
        ? process.env.CODEX_PROMPT_STDIN === "1" || process.env.CODEX_PROMPT_STDIN.toLowerCase() === "true"
        : parsed.codex.promptStdin
    }
  };
}

export function isAcceptedAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
}
