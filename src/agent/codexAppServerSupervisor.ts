import type { CodexAppServerConfig, CodexServiceStatus, TaskLogStream } from "../shared/types.js";
import { ensureCodexAppServerReady, isCodexAppServerReady } from "./codexAppServer.js";

interface SupervisorDependencies {
  ensureReady: typeof ensureCodexAppServerReady;
  probeReady: typeof isCodexAppServerReady;
}

export class CodexAppServerSupervisor {
  private timer?: NodeJS.Timeout;
  private checking?: Promise<void>;
  private status: CodexServiceStatus;

  constructor(
    private readonly config: CodexAppServerConfig,
    private readonly dependencies: SupervisorDependencies = {
      ensureReady: ensureCodexAppServerReady,
      probeReady: isCodexAppServerReady
    }
  ) {
    this.status = {
      phase: config.enabled ? "starting" : "disabled",
      ready: false,
      checkedAt: new Date().toISOString(),
      endpoint: config.url
    };
  }

  start(): void {
    if (!this.config.enabled || this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.config.supervisorIntervalMs ?? 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  getStatus(): CodexServiceStatus {
    return { ...this.status };
  }

  async ensureReady(): Promise<void> {
    await this.dependencies.ensureReady(this.config, this.log);
    const ready = await this.dependencies.probeReady(this.config.url);
    if (!ready) throw new Error("Codex app-server did not become ready");
    this.setStatus("ready", true);
  }

  async check(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.checking) return this.checking;
    this.checking = (async () => {
      try {
        if (await this.dependencies.probeReady(this.config.url)) {
          this.setStatus("ready", true);
          return;
        }
        this.setStatus(this.status.phase === "starting" ? "starting" : "recovering", false);
        await this.ensureReady();
      } catch (error) {
        this.setStatus("recovering", false, error instanceof Error ? error.message : String(error));
      } finally {
        this.checking = undefined;
      }
    })();
    return this.checking;
  }

  private readonly log = (_stream: TaskLogStream, _text: string): void => undefined;

  private setStatus(phase: CodexServiceStatus["phase"], ready: boolean, error?: string): void {
    this.status = {
      phase,
      ready,
      checkedAt: new Date().toISOString(),
      endpoint: this.config.url,
      ...(error ? { error } : {})
    };
  }
}
