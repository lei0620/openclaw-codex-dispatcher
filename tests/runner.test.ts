import { describe, expect, it } from "vitest";
import { buildCodexSpawn } from "../src/agent/runner.js";

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
});
