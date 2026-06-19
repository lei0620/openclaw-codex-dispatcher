import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  CodexAppServerConfig,
  CodexCommandConfig,
  DesktopInputConfig,
  ProjectConfig,
  TaskLogStream,
  TaskRecord,
  TaskResult
} from "../shared/types.js";
import { runCodexAppServerTask } from "./codexAppServer.js";
import { runDesktopInputTask } from "./desktopInput.js";

const execFileAsync = promisify(execFile);

interface BuildContext {
  projectPath: string;
  prompt: string;
  codexSessionId?: string;
}

interface SpawnSpec {
  command: string;
  args: string[];
  stdin?: string;
}

export function buildCodexSpawn(config: CodexCommandConfig, context: BuildContext): SpawnSpec {
  const args = config.args.map((arg) => replaceTemplate(arg, context));
  if (context.codexSessionId) {
    applyCodexResumeArgs(args, context.codexSessionId, context.prompt);
  }
  return {
    command: replaceTemplate(config.command, context),
    args,
    stdin: config.promptStdin ? context.prompt : undefined
  };
}

export async function runCodexTask(
  codex: CodexCommandConfig,
  appServer: CodexAppServerConfig,
  desktopInput: DesktopInputConfig,
  task: TaskRecord,
  project: ProjectConfig,
  signal: AbortSignal,
  onLog: (stream: TaskLogStream, text: string) => void,
  onApproval?: (message: string) => Promise<boolean>
): Promise<TaskResult> {
  if (task.mode === "dry-run") {
    onLog("system", `dry-run: would execute in ${project.path}`);
    return { exitCode: 0, summary: "Dry run completed without invoking Codex.", diffSummary: "not checked" };
  }

  const codexSessionId = getCodexSessionId(task);
  if (desktopInput.enabled && task.mode === "codex") {
    try {
      return await runDesktopInputTask(desktopInput, task, project, signal, onLog);
    } catch (error) {
      if (signal.aborted) {
        return { exitCode: 1, summary: "Cancelled by request.", diffSummary: "not checked" };
      }
      onLog(
        "system",
        `desktop input unavailable; falling back to desktop app-server: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (appServer.enabled && task.mode === "codex") {
    try {
      const result = await runCodexAppServerTask(appServer, codexSessionId, task, project, signal, onLog, onApproval);
      return { ...result, diffSummary: await readDiffSummary(project.path) };
    } catch (error) {
      if (signal.aborted) {
        return { exitCode: 1, summary: "Cancelled by request.", diffSummary: "not checked" };
      }
      onLog(
        "system",
        `desktop app-server unavailable; falling back to Codex CLI: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const spec = buildCodexSpawn(codex, {
    projectPath: project.path,
    prompt: task.prompt,
    codexSessionId
  });
  onLog("system", `starting ${spec.command} ${spec.args.join(" ")}`);

  const exitCode = await new Promise<number>((resolve, reject) => {
    let recentOutput = "";
    let approvalInFlight = false;
    const child = spawn(spec.command, spec.args, {
      cwd: project.path,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const abort = () => {
      onLog("system", "cancellation requested; stopping Codex process");
      if (!child.stdin.destroyed) {
        child.stdin.write("n\n");
      }
      child.kill("SIGTERM");
    };
    signal.addEventListener("abort", abort, { once: true });

    const handleChunk = (stream: TaskLogStream, chunk: Buffer) => {
      const text = chunk.toString();
      onLog(stream, text);
      recentOutput = `${recentOutput}\n${text}`.slice(-4000);
      const approvalMessage = detectApprovalPrompt(recentOutput);
      if (!approvalMessage || approvalInFlight || !onApproval) {
        return;
      }
      approvalInFlight = true;
      onApproval(approvalMessage)
        .then((approved) => {
          if (!child.stdin.destroyed) {
            child.stdin.write(approved ? "y\n" : "n\n");
          }
        })
        .catch((error) => {
          onLog("system", `approval failed: ${error instanceof Error ? error.message : String(error)}`);
          if (!child.stdin.destroyed) {
            child.stdin.write("n\n");
          }
        })
        .finally(() => {
          approvalInFlight = false;
          recentOutput = "";
        });
    };

    child.stdout.on("data", (chunk) => handleChunk("stdout", chunk));
    child.stderr.on("data", (chunk) => handleChunk("stderr", chunk));
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

function getCodexSessionId(task: TaskRecord): string | undefined {
  const prefix = "codex:";
  if (task.codexSessionId) {
    return task.codexSessionId;
  }
  return task.conversationId?.startsWith(prefix) ? task.conversationId.slice(prefix.length) : undefined;
}

function applyCodexResumeArgs(args: string[], sessionId: string, prompt: string): void {
  const execIndex = args.indexOf("exec");
  if (execIndex < 0 || args.includes("resume")) {
    return;
  }
  removeOptionWithValue(args, "--cd");
  args.splice(execIndex + 1, 0, "resume");
  const promptIndex = prompt ? args.lastIndexOf(prompt) : -1;
  if (promptIndex > execIndex + 1) {
    args.splice(promptIndex, 0, sessionId);
  } else {
    args.push(sessionId);
  }
}

function removeOptionWithValue(args: string[], option: string): void {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== option) {
      continue;
    }
    args.splice(index, 2);
    index -= 1;
  }
}

export function detectApprovalPrompt(text: string): string | undefined {
  const normalized = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim();
  const patterns = [
    /approval required/i,
    /requires approval/i,
    /requesting approval/i,
    /allow (this )?(command|edit|change|patch)/i,
    /approve (this )?(command|edit|change|patch)/i,
    /do you want to (continue|proceed|allow|approve)/i,
    /run command\?/i,
    /apply patch\?/i,
    /\[y\/n\]/i,
    /\(y\/n\)/i,
    /继续.*(吗|？|\?)/,
    /是否.*(允许|批准|继续)/
  ];
  if (!patterns.some((pattern) => pattern.test(normalized))) {
    return undefined;
  }
  return normalized.split(/\r?\n/).slice(-8).join("\n");
}

async function readDiffSummary(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--stat"], { cwd, windowsHide: true });
    return stdout.trim() || "no changes";
  } catch {
    return "git diff unavailable";
  }
}
