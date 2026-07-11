import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAppServerSpawnSpec,
  buildWindowsDesktopRefreshArgs,
  buildWindowsAppServerStartArgs,
  isCodexAppServerReady,
  parseRefreshWindowTarget,
  resolveCodexAppServerCommand,
  runCodexAppServerTask
} from "../src/agent/codexAppServer.js";
import type { ProjectConfig, TaskRecord } from "../src/shared/types.js";

let server: http.Server | undefined;
let wss: WebSocketServer | undefined;

afterEach(async () => {
  wss?.close();
  wss = undefined;
  if (!server) {
    return;
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

describe("runCodexAppServerTask", () => {
  it("reports false when the loopback app-server endpoint is unavailable", async () => {
    await expect(isCodexAppServerReady("ws://127.0.0.1:1")).resolves.toBe(false);
  });

  it("builds a PowerShell Start-Process command for Windows app-server startup", () => {
    const args = buildWindowsAppServerStartArgs("C:/Tools/Codex/codex.exe", "ws://127.0.0.1:18765");

    expect(args).toContain("-Command");
    expect(args.join(" ")).toContain("Start-Process");
    expect(args.join(" ")).toContain("'C:/Tools/Codex/codex.exe'");
    expect(args.join(" ")).toContain("'ws://127.0.0.1:18765'");
    expect(args.join(" ")).toContain("-WindowStyle Hidden");
    expect(args.join(" ")).not.toContain("-RedirectStandardOutput");
    expect(args.join(" ")).not.toContain("-RedirectStandardError");
  });

  it("uses a non-detached hidden PowerShell launcher on Windows", () => {
    const launcher = buildAppServerSpawnSpec("C:/Tools/Codex/codex.exe", "ws://127.0.0.1:18765", "win32");

    expect(launcher.command).toBe("powershell.exe");
    expect(launcher.options.windowsHide).toBe(true);
    expect(launcher.options.detached).toBeUndefined();
    expect(launcher.options.stdio).toBe("ignore");
  });

  it("builds a hidden desktop refresh command without prompt input", () => {
    const args = buildWindowsDesktopRefreshArgs("scripts/refresh-codex-desktop.ps1", "Codex|OpenAI");
    const script = args.join(" ");

    expect(args).toEqual(
      expect.arrayContaining(["-Sta", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
    );
    expect(script).toContain("refresh-codex-desktop.ps1");
    expect(script).toContain("-WindowTitlePattern");
    expect(script).toContain("Codex|OpenAI");
    expect(script).not.toContain("-AllowMultipleWindows");
    expect(script).not.toContain("-PromptFile");
  });

  it("adds a bound window handle to the desktop refresh command", () => {
    const args = buildWindowsDesktopRefreshArgs("scripts/refresh-codex-desktop.ps1", "Codex|OpenAI", { handle: "123456" });
    const script = args.join(" ");

    expect(script).toContain("-WindowHandle");
    expect(script).toContain("123456");
    expect(script).not.toContain("-AllowMultipleWindows");
  });

  it("adds a bound process id to the desktop refresh command", () => {
    const target = parseRefreshWindowTarget("LEI-PC:pid:24228");
    const args = buildWindowsDesktopRefreshArgs("scripts/refresh-codex-desktop.ps1", "Codex|OpenAI", target);
    const script = args.join(" ");

    expect(target).toEqual({ processId: "24228" });
    expect(script).toContain("-WindowProcessId");
    expect(script).toContain("24228");
  });

  it("skips stale Codex bin directories when resolving the app-server command", () => {
    const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-localappdata-"));
    const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
    fs.mkdirSync(path.join(binRoot, "stale"), { recursive: true });
    fs.mkdirSync(path.join(binRoot, "current"), { recursive: true });
    const command = path.join(binRoot, "current", "codex.exe");
    fs.writeFileSync(command, "");

    expect(resolveCodexAppServerCommand(undefined, localAppData)).toBe(command);
  });

  it("does not leak an unhandled rejection when setup fails before a turn starts", async () => {
    const { url } = await startBrokenAppServer();
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => {
      unhandled.push(error);
    };
    process.on("unhandledRejection", onUnhandled);

    await expect(
      runCodexAppServerTask(
        {
          enabled: true,
          url,
          startupTimeoutMs: 100,
          requestTimeoutMs: 1000,
          turnTimeoutMs: 1000
        },
        undefined,
        createTask(),
        createProject(),
        new AbortController().signal,
        () => undefined
      )
    ).rejects.toThrow(/did not return a turn id/i);

    await new Promise((resolve) => setTimeout(resolve, 50));
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });
});

async function startBrokenAppServer(): Promise<{ url: string }> {
  server = http.createServer((req, res) => {
    if (req.url === "/readyz") {
      res.writeHead(200).end("ok");
      return;
    }
    res.writeHead(404).end();
  });
  wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { id?: number; method?: string };
      if (!message.id) {
        return;
      }
      if (message.method === "turn/start") {
        ws.send(JSON.stringify({ id: message.id, result: { turn: {} } }));
        return;
      }
      ws.send(JSON.stringify({ id: message.id, result: { thread: { id: "thread-1" } } }));
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `ws://127.0.0.1:${port}` };
}

function createTask(): TaskRecord {
  return {
    id: "task-1",
    projectId: "openclaw",
    prompt: "hello",
    mode: "codex",
    source: "panel",
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: []
  };
}

function createProject(): ProjectConfig {
  return {
    id: "openclaw",
    name: "OpenClaw",
    path: "D:/aixm/openclaw",
    defaultMode: "codex",
    allowedModes: ["codex"],
    notify: true
  };
}
