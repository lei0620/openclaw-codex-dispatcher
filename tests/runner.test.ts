import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildCodexSpawn, detectApprovalPrompt, selectCodexExecutionPlan, runCodexTask } from "../src/agent/runner.js";
import type { ProjectConfig, TaskRecord } from "../src/shared/types.js";

describe("buildCodexSpawn", () => {
  it("replaces prompt and project path placeholders without using a shell", () => {
    const spawn = buildCodexSpawn(
      {
        command: "codex",
        args: ["exec", "--cd", "{{projectPath}}", "{{prompt}}"],
        promptStdin: false
      },
      {
        projectPath: "D:/aixm/openclaw",
        prompt: "fix tests && do not shell inject"
      }
    );

    expect(spawn).toEqual({
      command: "codex",
      args: ["exec", "--cd", "D:/aixm/openclaw", "fix tests && do not shell inject"],
      stdin: undefined
    });
  });

  it("passes the prompt through stdin when configured", () => {
    const spawn = buildCodexSpawn(
      {
        command: "codex",
        args: ["exec", "--cd", "{{projectPath}}"],
        promptStdin: true
      },
      { projectPath: "D:/aixm/openclaw", prompt: "summarize" }
    );

    expect(spawn.stdin).toBe("summarize");
  });

  it("resumes a synced desktop Codex conversation when a codex session id is present", () => {
    const spawn = buildCodexSpawn(
      {
        command: "codex",
        args: ["exec", "--skip-git-repo-check", "--cd", "{{projectPath}}", "{{prompt}}"],
        promptStdin: false
      },
      {
        projectPath: "D:/aixm/openclaw",
        prompt: "继续",
        codexSessionId: "019e7d6c-93de-75e0-91e6-412ba7da3b5a"
      }
    );

    expect(spawn.args).toEqual([
      "exec",
      "resume",
      "--skip-git-repo-check",
      "019e7d6c-93de-75e0-91e6-412ba7da3b5a",
      "继续"
    ]);
  });

  it("resumes with stdin prompts without keeping the --cd option", () => {
    const spawn = buildCodexSpawn(
      {
        command: "codex",
        args: ["exec", "--skip-git-repo-check", "--cd", "{{projectPath}}"],
        promptStdin: true
      },
      {
        projectPath: "D:/aixm/openclaw",
        prompt: "继续",
        codexSessionId: "019e7d6c-93de-75e0-91e6-412ba7da3b5a"
      }
    );

    expect(spawn.args).toEqual(["exec", "resume", "--skip-git-repo-check", "019e7d6c-93de-75e0-91e6-412ba7da3b5a"]);
    expect(spawn.stdin).toBe("继续");
  });

  it("detects authorization prompts from Codex output", () => {
    expect(detectApprovalPrompt("Codex wants to run command?\n[y/n]")).toContain("run command");
    expect(detectApprovalPrompt("ordinary task output")).toBeUndefined();
  });

  it("uses the bound desktop window for an existing synced Codex conversation", () => {
    const task = createRunnerTask({
      source: "panel",
      codexSessionId: "019ea06b-17d8-7a32-8106-334d3ae55286",
      refreshWindowId: "LEI-PC:pid:24228"
    });

    expect(
      selectCodexExecutionPlan(
        { enabled: true, url: "ws://127.0.0.1:18765", startupTimeoutMs: 60000, requestTimeoutMs: 30000, turnTimeoutMs: 120000 },
        {
          enabled: true,
          allowUnsafeForegroundRouting: true,
          scriptPath: "scripts/send-codex-desktop-input.ps1",
          clickYOffset: 92,
          windowTitlePattern: "Codex|OpenAI",
          responseTimeoutMs: 180000
        },
        task
      )
    ).toEqual(["desktop-input"]);
  });

  it("uses app-server to create a real desktop conversation for new phone panel chats", () => {
    const task = createRunnerTask({
      source: "panel",
      refreshWindowId: "LEI-PC:pid:24228"
    });

    expect(
      selectCodexExecutionPlan(
        { enabled: true, url: "ws://127.0.0.1:18765", startupTimeoutMs: 60000, requestTimeoutMs: 30000, turnTimeoutMs: 120000 },
        {
          enabled: true,
          allowUnsafeForegroundRouting: true,
          scriptPath: "scripts/send-codex-desktop-input.ps1",
          clickYOffset: 92,
          windowTitlePattern: "Codex|OpenAI",
          responseTimeoutMs: 180000
        },
        task
      )
    ).toEqual(["app-server"]);
  });

  it("can use exact desktop session routing even when the separate app-server is disabled", () => {
    const task = createRunnerTask({
      source: "panel",
      codexSessionId: "019ea06b-17d8-7a32-8106-334d3ae55286",
      refreshWindowId: "LEI-PC:pid:24228"
    });

    expect(
      selectCodexExecutionPlan(
        { enabled: false, url: "ws://127.0.0.1:18765", startupTimeoutMs: 60000, requestTimeoutMs: 30000, turnTimeoutMs: 120000 },
        {
          enabled: true,
          allowUnsafeForegroundRouting: true,
          scriptPath: "scripts/send-codex-desktop-input.ps1",
          clickYOffset: 92,
          windowTitlePattern: "Codex|OpenAI",
          responseTimeoutMs: 180000
        },
        task
      )
    ).toEqual(["desktop-input"]);
  });

  it("does not fall back to CLI when a desktop Codex session task cannot use app-server", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runner-"));
    const marker = path.join(cwd, "cli-ran.txt");
    const task = createRunnerTask({
      codexSessionId: "019ea06b-17d8-7a32-8106-334d3ae55286",
      conversationId: "codex:019ea06b-17d8-7a32-8106-334d3ae55286"
    });
    const project = createProject(cwd);
    const logs: string[] = [];

    const result = await runCodexTask(
      {
        command: process.execPath,
        args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
        promptStdin: false
      },
      {
        enabled: true,
        url: "ws://127.0.0.1:9",
        command: process.execPath,
        startupTimeoutMs: 50,
        requestTimeoutMs: 50,
        turnTimeoutMs: 50
      },
      {
        enabled: true,
        allowUnsafeForegroundRouting: true,
        scriptPath: "scripts/send-codex-desktop-input.ps1",
        clickYOffset: 92,
        windowTitlePattern: "Codex|OpenAI",
        responseTimeoutMs: 100
      },
      task,
      project,
      new AbortController().signal,
      (_stream, text) => logs.push(text)
    );

    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("Codex desktop app-server unavailable");
    expect(fs.existsSync(marker)).toBe(false);
    expect(logs.join("")).not.toContain("falling back");
  });

  it("does not fall back to CLI when a new phone conversation cannot start app-server", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-phone-routing-"));
    const marker = path.join(cwd, "cli-ran.txt");
    const phoneTask = createRunnerTask({
      source: "panel",
      conversationId: "phone-conversation",
      codexSessionId: undefined
    });
    const result = await runCodexTask(
      {
        command: process.execPath,
        args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
        promptStdin: false
      },
      {
        enabled: true,
        url: "ws://127.0.0.1:9",
        command: process.execPath,
        startupTimeoutMs: 50,
        requestTimeoutMs: 50,
        turnTimeoutMs: 50,
        supervisorIntervalMs: 5000,
        heartbeatIntervalMs: 10000
      },
      {
        enabled: true,
        allowUnsafeForegroundRouting: true,
        scriptPath: "scripts/send-codex-desktop-input.ps1",
        clickYOffset: 92,
        windowTitlePattern: "Codex|OpenAI",
        responseTimeoutMs: 100
      },
      phoneTask,
      createProject(cwd),
      new AbortController().signal,
      vi.fn()
    );

    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("Codex desktop app-server unavailable");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("never selects desktop-input for a phone panel task", () => {
    expect(
      selectCodexExecutionPlan(
        {
          enabled: true,
          url: "ws://127.0.0.1:18765",
          startupTimeoutMs: 60000,
          requestTimeoutMs: 30000,
          turnTimeoutMs: 120000,
          supervisorIntervalMs: 5000,
          heartbeatIntervalMs: 10000
        },
        {
          enabled: true,
          allowUnsafeForegroundRouting: true,
          scriptPath: "scripts/send-codex-desktop-input.ps1",
          clickYOffset: 92,
          windowTitlePattern: "Codex|OpenAI",
          responseTimeoutMs: 100
        },
        createRunnerTask({
          source: "panel",
          conversationId: "phone-conversation",
          refreshWindowId: "LEI-PC:hwnd:1"
        })
      )
    ).toEqual(["app-server"]);
  });

  it("does not use unsafe foreground desktop input for phone-created tasks by default", () => {
    const task = createRunnerTask({ source: "panel" });

    expect(
      selectCodexExecutionPlan(
        { enabled: false, url: "ws://127.0.0.1:18765", startupTimeoutMs: 60000, requestTimeoutMs: 30000, turnTimeoutMs: 120000 },
        {
          enabled: true,
          scriptPath: "scripts/send-codex-desktop-input.ps1",
          clickYOffset: 92,
          windowTitlePattern: "Codex|OpenAI",
          responseTimeoutMs: 180000
        },
        task
      )
    ).toEqual(["cli"]);
  });

  it("closes stdin even when the prompt is passed as an argument", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runner-"));
    const task: TaskRecord = {
      id: "task-1",
      projectId: "project-1",
      prompt: "hello",
      mode: "codex",
      source: "panel",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      logs: []
    };
    const project = createProject(cwd);
    const logs: string[] = [];

    const result = await runCodexTask(
      {
        command: process.execPath,
        args: ["-e", "process.stdin.resume(); process.stdin.on('end', () => console.log('stdin closed'));"],
        promptStdin: false
      },
      {
        enabled: false,
        url: "ws://127.0.0.1:8765",
        startupTimeoutMs: 100,
        requestTimeoutMs: 100,
        turnTimeoutMs: 100
      },
      {
        enabled: false,
        scriptPath: "scripts/send-codex-desktop-input.ps1",
        clickYOffset: 92,
        windowTitlePattern: "Codex|OpenAI",
        responseTimeoutMs: 100
      },
      task,
      project,
      new AbortController().signal,
      (_stream, text) => logs.push(text)
    );

    expect(result.exitCode).toBe(0);
    expect(logs.join("")).toContain("stdin closed");
  });
});

function createRunnerTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    projectId: "project-1",
    prompt: "hello",
    mode: "codex",
    source: "panel",
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [],
    ...overrides
  };
}

function createProject(projectPath: string): ProjectConfig {
  return {
    id: "project-1",
    name: "Project",
    path: projectPath,
    defaultMode: "codex",
    allowedModes: ["codex"],
    notify: true
  };
}
