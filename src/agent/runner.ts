import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodexCommandConfig, ProjectConfig, TaskLogStream, TaskRecord, TaskResult } from "../shared/types.js";

const execFileAsync = promisify(execFile);

interface BuildContext {
  projectPath: string;
  prompt: string;
}

interface SpawnSpec {
  command: string;
  args: string[];
  stdin?: string;
}

export function buildCodexSpawn(config: CodexCommandConfig, context: BuildContext): SpawnSpec {
  return {
    command: replaceTemplate(config.command, context),
    args: config.args.map((arg) => replaceTemplate(arg, context)),
    stdin: config.promptStdin ? context.prompt : undefined
  };
}

export async function runCodexTask(
  codex: CodexCommandConfig,
  task: TaskRecord,
  project: ProjectConfig,
  signal: AbortSignal,
  onLog: (stream: TaskLogStream, text: string) => void
): Promise<TaskResult> {
  if (task.mode === "dry-run") {
    onLog("system", `dry-run: would execute in ${project.path}`);
    return { exitCode: 0, summary: "Dry run completed without invoking Codex.", diffSummary: "not checked" };
  }

  const spec = buildCodexSpawn(codex, { projectPath: project.path, prompt: task.prompt });
  onLog("system", `starting ${spec.command} ${spec.args.join(" ")}`);

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: project.path,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const abort = () => {
      onLog("system", "cancellation requested; stopping Codex process");
      child.kill("SIGTERM");
    };
    signal.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk) => onLog("stdout", chunk.toString()));
    child.stderr.on("data", (chunk) => onLog("stderr", chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      resolve(code ?? 1);
    });

    if (spec.stdin) {
      child.stdin.write(spec.stdin);
    }
    child.stdin.end();
  });

  if (signal.aborted) {
    return { exitCode, summary: "Cancelled by request.", diffSummary: "not checked" };
  }
  const diffSummary = await readDiffSummary(project.path);
  return {
    exitCode,
    summary: exitCode === 0 ? "Codex task completed." : `Codex exited with code ${exitCode}.`,
    diffSummary
  };
}

function replaceTemplate(value: string, context: BuildContext): string {
  return value.replaceAll("{{prompt}}", context.prompt).replaceAll("{{projectPath}}", context.projectPath);
}

async function readDiffSummary(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--stat"], { cwd, windowsHide: true });
    return stdout.trim() || "no changes";
  } catch {
    return "git diff unavailable";
  }
}
