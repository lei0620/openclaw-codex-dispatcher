import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCodexSpawn, detectApprovalPrompt, runCodexTask } from "../src/agent/runner.js";
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
    const project: ProjectConfig = {
      id: "project-1",
      name: "Project",
      path: cwd,
      defaultMode: "codex",
      allowedModes: ["codex"],
      notify: true
    };
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
        requestTimeoutMs: 100
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
