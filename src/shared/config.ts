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
  }),
  codexAppServer: z
    .object({
      enabled: z.boolean().default(false),
      url: z.string().url().default("ws://127.0.0.1:18765"),
      command: z.string().min(1).optional(),
      startupTimeoutMs: z.coerce.number().int().positive().default(60000),
      requestTimeoutMs: z.coerce.number().int().positive().default(30000),
      turnTimeoutMs: z.coerce.number().int().positive().default(120000),
      supervisorIntervalMs: z.coerce.number().int().positive().default(5000),
      heartbeatIntervalMs: z.coerce.number().int().positive().default(10000),
      refreshDesktopAfterTurn: z.boolean().default(false),
      refreshScriptPath: z.string().min(1).default("scripts/refresh-codex-desktop.ps1"),
      refreshWindowTitlePattern: z.string().min(1).default("Codex|OpenAI"),
      refreshTimeoutMs: z.coerce.number().int().positive().default(8000)
    })
    .default({
      enabled: false,
      url: "ws://127.0.0.1:18765",
      startupTimeoutMs: 60000,
      requestTimeoutMs: 30000,
      turnTimeoutMs: 120000,
      supervisorIntervalMs: 5000,
      heartbeatIntervalMs: 10000,
      refreshDesktopAfterTurn: false,
      refreshScriptPath: "scripts/refresh-codex-desktop.ps1",
      refreshWindowTitlePattern: "Codex|OpenAI",
      refreshTimeoutMs: 8000
    }),
  desktopInput: z
    .object({
      enabled: z.boolean().default(false),
      allowUnsafeForegroundRouting: z.boolean().default(false),
      scriptPath: z.string().min(1).default("scripts/send-codex-desktop-input.ps1"),
      clickYOffset: z.coerce.number().int().positive().default(92),
      windowTitlePattern: z.string().min(1).default("Codex|OpenAI"),
      responseTimeoutMs: z.coerce.number().int().positive().default(180000)
    })
    .default({
      enabled: false,
      allowUnsafeForegroundRouting: false,
      scriptPath: "scripts/send-codex-desktop-input.ps1",
      clickYOffset: 92,
      windowTitlePattern: "Codex|OpenAI",
      responseTimeoutMs: 180000
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
    },
    codexAppServer: {
      enabled: process.env.CODEX_APP_SERVER_ENABLED
        ? process.env.CODEX_APP_SERVER_ENABLED === "1" || process.env.CODEX_APP_SERVER_ENABLED.toLowerCase() === "true"
        : parsed.codexAppServer.enabled,
      url: process.env.CODEX_APP_SERVER_URL ?? parsed.codexAppServer.url,
      command: process.env.CODEX_APP_SERVER_COMMAND ?? parsed.codexAppServer.command,
      startupTimeoutMs: process.env.CODEX_APP_SERVER_STARTUP_TIMEOUT_MS
        ? Number(process.env.CODEX_APP_SERVER_STARTUP_TIMEOUT_MS)
        : parsed.codexAppServer.startupTimeoutMs,
      requestTimeoutMs: process.env.CODEX_APP_SERVER_REQUEST_TIMEOUT_MS
        ? Number(process.env.CODEX_APP_SERVER_REQUEST_TIMEOUT_MS)
        : parsed.codexAppServer.requestTimeoutMs,
      turnTimeoutMs: process.env.CODEX_APP_SERVER_TURN_TIMEOUT_MS
        ? Number(process.env.CODEX_APP_SERVER_TURN_TIMEOUT_MS)
        : parsed.codexAppServer.turnTimeoutMs,
      supervisorIntervalMs: process.env.CODEX_APP_SERVER_SUPERVISOR_INTERVAL_MS
        ? Number(process.env.CODEX_APP_SERVER_SUPERVISOR_INTERVAL_MS)
        : parsed.codexAppServer.supervisorIntervalMs,
      heartbeatIntervalMs: process.env.CODEX_APP_SERVER_HEARTBEAT_INTERVAL_MS
        ? Number(process.env.CODEX_APP_SERVER_HEARTBEAT_INTERVAL_MS)
        : parsed.codexAppServer.heartbeatIntervalMs,
      refreshDesktopAfterTurn: process.env.CODEX_APP_SERVER_REFRESH_DESKTOP_AFTER_TURN
        ? process.env.CODEX_APP_SERVER_REFRESH_DESKTOP_AFTER_TURN === "1" ||
          process.env.CODEX_APP_SERVER_REFRESH_DESKTOP_AFTER_TURN.toLowerCase() === "true"
        : parsed.codexAppServer.refreshDesktopAfterTurn,
      refreshScriptPath: process.env.CODEX_APP_SERVER_REFRESH_SCRIPT ?? parsed.codexAppServer.refreshScriptPath,
      refreshWindowTitlePattern:
        process.env.CODEX_APP_SERVER_REFRESH_WINDOW_TITLE_PATTERN ??
        parsed.codexAppServer.refreshWindowTitlePattern,
      refreshTimeoutMs: process.env.CODEX_APP_SERVER_REFRESH_TIMEOUT_MS
        ? Number(process.env.CODEX_APP_SERVER_REFRESH_TIMEOUT_MS)
        : parsed.codexAppServer.refreshTimeoutMs
    },
    desktopInput: {
      enabled: process.env.CODEX_DESKTOP_INPUT_ENABLED
        ? process.env.CODEX_DESKTOP_INPUT_ENABLED === "1" ||
          process.env.CODEX_DESKTOP_INPUT_ENABLED.toLowerCase() === "true"
        : parsed.desktopInput.enabled,
      allowUnsafeForegroundRouting: process.env.CODEX_DESKTOP_INPUT_ALLOW_UNSAFE_FOREGROUND
        ? process.env.CODEX_DESKTOP_INPUT_ALLOW_UNSAFE_FOREGROUND === "1" ||
          process.env.CODEX_DESKTOP_INPUT_ALLOW_UNSAFE_FOREGROUND.toLowerCase() === "true"
        : parsed.desktopInput.allowUnsafeForegroundRouting,
      scriptPath: process.env.CODEX_DESKTOP_INPUT_SCRIPT ?? parsed.desktopInput.scriptPath,
      clickYOffset: process.env.CODEX_DESKTOP_INPUT_CLICK_Y_OFFSET
        ? Number(process.env.CODEX_DESKTOP_INPUT_CLICK_Y_OFFSET)
        : parsed.desktopInput.clickYOffset,
      windowTitlePattern: process.env.CODEX_DESKTOP_INPUT_WINDOW_TITLE_PATTERN ?? parsed.desktopInput.windowTitlePattern,
      responseTimeoutMs: process.env.CODEX_DESKTOP_INPUT_RESPONSE_TIMEOUT_MS
        ? Number(process.env.CODEX_DESKTOP_INPUT_RESPONSE_TIMEOUT_MS)
        : parsed.desktopInput.responseTimeoutMs
    }
  };
}

export function isAcceptedAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
}
