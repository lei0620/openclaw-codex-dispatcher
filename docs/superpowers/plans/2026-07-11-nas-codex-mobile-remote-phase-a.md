# NAS Codex Mobile Remote Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stable connection core that automatically recognizes the current Codex desktop app, keeps the local Codex app-server ready, reports NAS/agent/Codex status separately, and never routes a phone conversation through the wrong desktop-input fallback.

**Architecture:** Keep the NAS as the only LAN control endpoint and keep the Win11 agent as an outbound WebSocket client. Add a small app-server supervisor and explicit health protocol between agent and NAS; keep window discovery as an optional display-following feature rather than a message-routing dependency.

**Tech Stack:** TypeScript 5.7, Node.js 22, Express 4, `ws` 8, Vitest 4, PowerShell 5.1-compatible scripts, Capacitor 8 static Android web assets.

## Global Constraints

- The NAS relay must not depend on OpenClaw.
- Codex task execution must use the loopback app-server path for phone conversations.
- The app-server must listen on `127.0.0.1` only.
- Desktop input simulation must not be an automatic fallback for phone conversations.
- `codexSessionId` is the conversation identity; window handles are display-only metadata.
- Win11 must proactively connect to the NAS; no Win11 LAN control port may be opened.
- The phone UI must distinguish NAS reachability, Win11 agent presence, and Codex service readiness.
- Existing project whitelist, permission approval, cancellation, multi-conversation parallelism, and same-conversation serialization behavior must remain intact.
- Do not stage or revert unrelated existing worktree changes.
- Run every regression test once in the failing state before implementing its fix.

## File Structure

### New files

- `src/agent/codexAppServerSupervisor.ts`: owns app-server readiness probing, prewarming, retry state, and health snapshots.
- `public/connectionStatus.js`: pure UI status derivation independent from DOM rendering.
- `tests/codexAppServerSupervisor.test.ts`: deterministic supervisor state-machine tests.
- `tests/connectionStatus.test.ts`: NAS/agent/Codex state derivation tests.
- `tests/autostartScripts.test.ts`: static compatibility tests for Win11 watcher scripts.

### Existing files to modify

- `src/agent/codexWindows.ts`: recognize current `ChatGPT.exe` Codex desktop host as well as legacy `Codex.exe`.
- `scripts/refresh-codex-desktop.ps1`: target current and legacy Codex desktop hosts.
- `scripts/send-codex-desktop-input.ps1`: keep diagnostic-only window targeting compatible with the current host.
- `src/agent/codexAppServer.ts`: export readiness primitives used by the supervisor.
- `src/agent/index.ts`: start/stop the supervisor, send heartbeats, and report Codex health.
- `src/shared/types.ts`: define health snapshots and heartbeat messages.
- `src/shared/config.ts`: define supervisor heartbeat/retry defaults.
- `config/dispatcher.config.example.json`: document safe app-server defaults.
- `config/dispatcher.config.template.json`: document safe app-server defaults.
- `src/server/taskStore.ts`: persist current agent health and update `lastSeenAt` from heartbeats.
- `src/server/agentWs.ts`: accept heartbeats and mark stale agents offline.
- `src/server/api.ts`: return separate service health in `/api/health` and `/api/agents`.
- `src/agent/runner.ts`: make phone app-server failures terminal instead of silently falling through to CLI or desktop input.
- `scripts/watch-codex-start-agent.ps1`: recognize the current Codex host and reliably start the agent hidden.
- `scripts/setup-windows-agent.ps1`: generate an app-server-enabled local configuration.
- `public/app.js`: consume service health and render a truthful combined status.
- `public/index.html`: add accessible status detail markup and load the pure status module.
- `public/styles.css`: add compact green/yellow/red status states without changing the chat layout.
- `capacitor.config.ts`: disable Capacitor bridge logging so access credentials are not emitted through debug logcat.
- `tests/codexWindows.test.ts`, `tests/codexAppServer.test.ts`, `tests/agentWs.test.ts`, `tests/api.test.ts`, `tests/runner.test.ts`, `tests/config.test.ts`, `tests/panelUi.test.ts`, `tests/staticAssets.test.ts`: regression coverage.

---

### Task 1: Recognize Current and Legacy Codex Desktop Hosts

**Files:**
- Modify: `src/agent/codexWindows.ts`
- Modify: `scripts/refresh-codex-desktop.ps1`
- Modify: `scripts/send-codex-desktop-input.ps1`
- Modify: `tests/codexWindows.test.ts`
- Create: `tests/autostartScripts.test.ts`

**Interfaces:**
- Consumes: Windows executable paths from `Get-Process` and `EnumWindows`.
- Produces: `buildCodexDesktopExecutablePattern(): string` and a PowerShell regex that matches both `...\app\ChatGPT.exe` and `...\app\Codex.exe` under an `OpenAI.Codex_*` package.

- [ ] **Step 1: Write the failing host-detection tests**

Add to `tests/codexWindows.test.ts`:

```ts
import { buildCodexDesktopExecutablePattern, buildWindowDiscoveryScript } from "../src/agent/codexWindows.js";

it("matches the current ChatGPT.exe Codex desktop host", () => {
  const pattern = new RegExp(buildCodexDesktopExecutablePattern(), "i");
  expect(pattern.test("C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.707.3748.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe")).toBe(true);
});

it("keeps matching the legacy Codex.exe desktop host", () => {
  const pattern = new RegExp(buildCodexDesktopExecutablePattern(), "i");
  expect(pattern.test("C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.623.9142.0_x64__2p2nqsd0c76g0\\app\\Codex.exe")).toBe(true);
});

it("does not match the command-line app-server executable", () => {
  const pattern = new RegExp(buildCodexDesktopExecutablePattern(), "i");
  expect(pattern.test("C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.707.3748.0_x64__2p2nqsd0c76g0\\app\\resources\\codex.exe")).toBe(false);
});

it("embeds the same current-host alternatives in the PowerShell discovery script", () => {
  const script = buildWindowDiscoveryScript();
  expect(script).toContain("ChatGPT");
  expect(script).toContain("Codex");
});
```

Create `tests/autostartScripts.test.ts`:

```ts
import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Win11 Codex host scripts", () => {
  for (const file of [
    "scripts/refresh-codex-desktop.ps1",
    "scripts/send-codex-desktop-input.ps1"
  ]) {
    it(`${file} supports current and legacy desktop hosts`, () => {
      const source = fs.readFileSync(file, "utf8");
      expect(source).toContain("ChatGPT");
      expect(source).toContain("Codex");
      expect(source).toContain("OpenAI\\.Codex_");
    });
  }
});
```

- [ ] **Step 2: Run the tests and verify the current code fails**

Run:

```powershell
npm test -- tests/codexWindows.test.ts tests/autostartScripts.test.ts --run
```

Expected: FAIL because `buildCodexDesktopExecutablePattern` does not exist and the scripts only match the legacy host.

- [ ] **Step 3: Add one shared TypeScript pattern and update PowerShell filters**

Add to `src/agent/codexWindows.ts`:

```ts
export function buildCodexDesktopExecutablePattern(): string {
  return String.raw`\\OpenAI\.Codex_[^\\]+\\app\\(?:ChatGPT|Codex)\.exe$`;
}
```

Use the returned value in `buildWindowDiscoveryScript()` instead of the current `Codex.exe`-only regex. In both PowerShell scripts, use this equivalent filter:

```powershell
$_.Path -and $_.Path -match "\\OpenAI\.Codex_[^\\]+\\app\\(ChatGPT|Codex)\.exe$"
```

Do not match `app\resources\codex.exe`; it is the protocol process, not a visible desktop window.

- [ ] **Step 4: Run focused tests and inspect live window discovery**

Run:

```powershell
npm test -- tests/codexWindows.test.ts tests/autostartScripts.test.ts --run
npx tsx -e "import('./src/agent/codexWindows.ts').then(async ({ listCodexDesktopWindows }) => console.log(await listCodexDesktopWindows('LEI-PC')))"
```

Expected: tests PASS and live output contains at least one window whose process ID belongs to the current `ChatGPT.exe` host when Codex is open.

- [ ] **Step 5: Commit only Task 1 files**

```powershell
git add src/agent/codexWindows.ts scripts/refresh-codex-desktop.ps1 scripts/send-codex-desktop-input.ps1 tests/codexWindows.test.ts tests/autostartScripts.test.ts
git commit -m "fix: recognize current Codex desktop host"
```

---

### Task 2: Add a Loopback App-Server Supervisor

**Files:**
- Create: `src/agent/codexAppServerSupervisor.ts`
- Create: `tests/codexAppServerSupervisor.test.ts`
- Modify: `src/agent/codexAppServer.ts`
- Modify: `tests/codexAppServer.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/config.ts`
- Modify: `tests/config.test.ts`
- Modify: `config/dispatcher.config.example.json`
- Modify: `config/dispatcher.config.template.json`

**Interfaces:**
- Consumes: `CodexAppServerConfig`, `ensureCodexAppServerReady(config, onLog)`, and `isCodexAppServerReady(url)`.
- Produces:
  - `CodexServicePhase = "disabled" | "starting" | "ready" | "recovering" | "error"`
  - `CodexServiceStatus { phase, ready, checkedAt, endpoint, error? }`
  - `CodexAppServerSupervisor.start()`, `.stop()`, `.getStatus()`, and `.ensureReady()`.

- [ ] **Step 1: Write failing readiness-export tests**

Add to `tests/codexAppServer.test.ts`:

```ts
import { isCodexAppServerReady } from "../src/agent/codexAppServer.js";

it("reports false when the loopback app-server endpoint is unavailable", async () => {
  await expect(isCodexAppServerReady("ws://127.0.0.1:1")).resolves.toBe(false);
});
```

Add the following configuration assertions to `tests/config.test.ts`:

```ts
expect(config.codexAppServer.supervisorIntervalMs).toBe(5000);
expect(config.codexAppServer.heartbeatIntervalMs).toBe(10000);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- tests/codexAppServer.test.ts tests/config.test.ts --run
```

Expected: FAIL because the readiness function and config properties do not exist.

- [ ] **Step 3: Export readiness primitives and configuration**

Extend `CodexAppServerConfig` in `src/shared/types.ts`:

```ts
supervisorIntervalMs?: number;
heartbeatIntervalMs?: number;
```

Add the complete service-health types in the same file:

```ts
export type CodexServicePhase = "disabled" | "starting" | "ready" | "recovering" | "error";

export interface CodexServiceStatus {
  phase: CodexServicePhase;
  ready: boolean;
  checkedAt: string;
  endpoint: string;
  error?: string;
}
```

Add schema defaults and environment overrides in `src/shared/config.ts`:

```ts
supervisorIntervalMs: z.coerce.number().int().positive().default(5000),
heartbeatIntervalMs: z.coerce.number().int().positive().default(10000)
```

Export these wrappers from `src/agent/codexAppServer.ts`:

```ts
export async function isCodexAppServerReady(url: string): Promise<boolean> {
  return isReady(url, 800);
}

export async function ensureCodexAppServerReady(
  config: CodexAppServerConfig,
  onLog: (stream: TaskLogStream, text: string) => void
): Promise<void> {
  return ensureAppServer(config, onLog);
}
```

Update both public config examples with:

```json
"supervisorIntervalMs": 5000,
"heartbeatIntervalMs": 10000
```

- [ ] **Step 4: Write failing supervisor state-machine tests**

Create `tests/codexAppServerSupervisor.test.ts` with injected dependencies:

```ts
import { describe, expect, it, vi } from "vitest";
import { CodexAppServerSupervisor } from "../src/agent/codexAppServerSupervisor.js";

const config = {
  enabled: true,
  url: "ws://127.0.0.1:18765",
  startupTimeoutMs: 1000,
  requestTimeoutMs: 1000,
  turnTimeoutMs: 1000,
  supervisorIntervalMs: 5000,
  heartbeatIntervalMs: 10000
};

it("prewarms the app-server and reports ready", async () => {
  const ensureReady = vi.fn().mockResolvedValue(undefined);
  const probeReady = vi.fn().mockResolvedValue(true);
  const supervisor = new CodexAppServerSupervisor(config, { ensureReady, probeReady });

  await supervisor.ensureReady();

  expect(ensureReady).toHaveBeenCalledOnce();
  expect(supervisor.getStatus()).toMatchObject({ phase: "ready", ready: true });
});

it("reports recovering after a failed health check without throwing from the loop", async () => {
  const ensureReady = vi.fn().mockRejectedValue(new Error("startup failed"));
  const probeReady = vi.fn().mockResolvedValue(false);
  const supervisor = new CodexAppServerSupervisor(config, { ensureReady, probeReady });

  await expect(supervisor.check()).resolves.toBeUndefined();

  expect(supervisor.getStatus()).toMatchObject({ phase: "recovering", ready: false, error: "startup failed" });
});
```

- [ ] **Step 5: Run the new test and verify RED**

Run:

```powershell
npm test -- tests/codexAppServerSupervisor.test.ts --run
```

Expected: FAIL because `CodexAppServerSupervisor` does not exist.

- [ ] **Step 6: Implement the minimal supervisor**

Create `src/agent/codexAppServerSupervisor.ts` with this public shape:

```ts
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
    this.status = { phase, ready, checkedAt: new Date().toISOString(), endpoint: this.config.url, ...(error ? { error } : {}) };
  }
}
```

- [ ] **Step 7: Run Task 2 tests and build**

Run:

```powershell
npm test -- tests/codexAppServer.test.ts tests/codexAppServerSupervisor.test.ts tests/config.test.ts --run
npm run build
```

Expected: all focused tests PASS and TypeScript exits with code 0.

- [ ] **Step 8: Commit only Task 2 files**

```powershell
git add src/agent/codexAppServer.ts src/agent/codexAppServerSupervisor.ts src/shared/types.ts src/shared/config.ts config/dispatcher.config.example.json config/dispatcher.config.template.json tests/codexAppServer.test.ts tests/codexAppServerSupervisor.test.ts tests/config.test.ts
git commit -m "feat: supervise Codex app-server readiness"
```

---

### Task 3: Report Agent Heartbeats and Codex Health Through the NAS

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/agent/index.ts`
- Modify: `src/server/taskStore.ts`
- Modify: `src/server/agentWs.ts`
- Modify: `src/server/api.ts`
- Modify: `tests/agentWs.test.ts`
- Modify: `tests/api.test.ts`
- Modify: `tests/conversationStore.test.ts`

**Interfaces:**
- Consumes: `CodexAppServerSupervisor.getStatus()`.
- Produces:
  - `AgentClientMessage` variant `{ type: "agent.heartbeat"; sentAt: string; codex: CodexServiceStatus }`.
  - `AgentRecord.codex?: CodexServiceStatus`.
  - `TaskStore.heartbeatAgent(agentId, codex, at)`.
  - `TaskStore.markStaleAgentsOffline(cutoffMs, nowMs)`.
  - `TaskStore.isAgentReady(agentId): boolean` for assignment gating.

- [ ] **Step 1: Write failing heartbeat store tests**

Add to `tests/conversationStore.test.ts`:

```ts
it("updates agent last-seen and Codex health from a heartbeat", () => {
  const store = new TaskStore();
  store.upsertAgent("LEI-PC");
  store.heartbeatAgent("LEI-PC", {
    phase: "ready",
    ready: true,
    checkedAt: "2026-07-11T01:30:00.000Z",
    endpoint: "ws://127.0.0.1:18765"
  }, "2026-07-11T01:30:00.000Z");

  expect(store.listAgents()[0]).toMatchObject({
    id: "LEI-PC",
    online: true,
    lastSeenAt: "2026-07-11T01:30:00.000Z",
    codex: { ready: true, phase: "ready" }
  });
});

it("marks agents offline after the heartbeat deadline", () => {
  const store = new TaskStore();
  store.upsertAgent("LEI-PC");
  store.heartbeatAgent("LEI-PC", {
    phase: "ready",
    ready: true,
    checkedAt: "2026-07-11T01:30:00.000Z",
    endpoint: "ws://127.0.0.1:18765"
  }, "2026-07-11T01:30:00.000Z");

  store.markStaleAgentsOffline(30000, Date.parse("2026-07-11T01:30:31.000Z"));

  expect(store.listAgents()[0].online).toBe(false);
});

it("allows assignment only while the agent and Codex service are ready", () => {
  const store = new TaskStore();
  store.upsertAgent("LEI-PC");
  expect(store.isAgentReady("LEI-PC")).toBe(false);

  store.heartbeatAgent("LEI-PC", {
    phase: "ready",
    ready: true,
    checkedAt: "2026-07-11T01:30:00.000Z",
    endpoint: "ws://127.0.0.1:18765"
  }, "2026-07-11T01:30:00.000Z");

  expect(store.isAgentReady("LEI-PC")).toBe(true);
});
```

- [ ] **Step 2: Write failing WebSocket and API tests**

In `tests/agentWs.test.ts`, connect and authenticate an agent, send:

```ts
ws.send(JSON.stringify({
  type: "agent.heartbeat",
  sentAt: "2026-07-11T01:30:00.000Z",
  codex: {
    phase: "ready",
    ready: true,
    checkedAt: "2026-07-11T01:30:00.000Z",
    endpoint: "ws://127.0.0.1:18765"
  }
}));
```

Assert `store.listAgents()[0].codex.ready === true`.

In `tests/api.test.ts`, assert `/api/health` contains:

```ts
expect(response.body).toMatchObject({
  ok: true,
  services: {
    nas: { reachable: true },
    agents: { online: 1 },
    codex: { ready: 1 }
  }
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
npm test -- tests/conversationStore.test.ts tests/agentWs.test.ts tests/api.test.ts --run
```

Expected: FAIL because heartbeat methods, message types, and service health are absent.

- [ ] **Step 4: Implement shared types and TaskStore methods**

Extend `AgentRecord`:

```ts
codex?: CodexServiceStatus;
```

Extend `AgentClientMessage`:

```ts
| { type: "agent.heartbeat"; sentAt: string; codex: CodexServiceStatus }
```

Implement in `TaskStore`:

```ts
heartbeatAgent(agentId: string, codex: CodexServiceStatus, at = new Date().toISOString()): void {
  const current = this.agents.get(agentId) ?? { id: agentId, online: true, connectedAt: at, lastSeenAt: at };
  this.agents.set(agentId, { ...current, online: true, lastSeenAt: at, codex });
}

markStaleAgentsOffline(cutoffMs: number, nowMs = Date.now()): void {
  for (const [id, agent] of this.agents.entries()) {
    if (nowMs - Date.parse(agent.lastSeenAt) > cutoffMs) {
      this.agents.set(id, { ...agent, online: false });
    }
  }
}

isAgentReady(agentId: string): boolean {
  const agent = this.agents.get(agentId);
  return Boolean(agent?.online && agent.codex?.ready);
}
```

- [ ] **Step 5: Handle heartbeat messages and expose service health**

In `src/server/agentWs.ts`, handle `agent.heartbeat` only after authentication:

```ts
if (message.type === "agent.heartbeat") {
  store.heartbeatAgent(agentId, message.codex);
  return;
}
```

Start a 10-second stale-agent sweep and clear it when the WebSocket server closes. Use a 30-second cutoff. In `assignQueuedTasks`, skip a connected socket unless `store.isAgentReady(agentId)` is true, so queued work waits for a healthy app-server instead of entering a known recovery state.

In `/api/health`, return:

```ts
const agents = store.listAgents();
res.json({
  ok: true,
  agents,
  queued: store.listTasks().filter((task) => task.status === "queued").length,
  services: {
    nas: { reachable: true },
    agents: { online: agents.filter((agent) => agent.online).length },
    codex: { ready: agents.filter((agent) => agent.online && agent.codex?.ready).length }
  }
});
```

- [ ] **Step 6: Start the supervisor and heartbeat loop in the agent**

In `src/agent/index.ts`, instantiate one supervisor:

```ts
const appServerSupervisor = new CodexAppServerSupervisor(config.codexAppServer);
appServerSupervisor.start();
```

After `agent.accepted`, immediately send and then repeat every `heartbeatIntervalMs` (falling back to 10000 ms for direct test configurations):

```ts
import type { AgentClientMessage, DispatcherServerMessage } from "../shared/types.js";

let heartbeatTimer: NodeJS.Timeout | undefined;

const sendHeartbeat = (): void => {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: "agent.heartbeat",
    sentAt: new Date().toISOString(),
    codex: appServerSupervisor.getStatus()
  } satisfies AgentClientMessage));
};

heartbeatTimer = setInterval(sendHeartbeat, config.codexAppServer.heartbeatIntervalMs ?? 10000);
```

Clear the heartbeat timer on close, but keep the supervisor alive across NAS reconnects. Stop it only on process shutdown.

- [ ] **Step 7: Run Task 3 tests and build**

Run:

```powershell
npm test -- tests/conversationStore.test.ts tests/agentWs.test.ts tests/api.test.ts --run
npm run build
```

Expected: all focused tests PASS and build exits 0.

- [ ] **Step 8: Commit only Task 3 files**

```powershell
git add src/shared/types.ts src/agent/index.ts src/server/taskStore.ts src/server/agentWs.ts src/server/api.ts tests/conversationStore.test.ts tests/agentWs.test.ts tests/api.test.ts
git commit -m "feat: report agent and Codex service health"
```

---

### Task 4: Make Phone Conversation Routing Fail Closed

**Files:**
- Modify: `src/agent/runner.ts`
- Modify: `tests/runner.test.ts`
- Modify: `config/dispatcher.config.example.json`
- Modify: `config/dispatcher.config.template.json`

**Interfaces:**
- Consumes: `TaskRecord.source`, `TaskRecord.conversationId`, and app-server readiness.
- Produces: `isPhoneConversationTask(task): boolean`; phone tasks never reach CLI or desktop-input after an app-server failure.

- [ ] **Step 1: Write failing safe-routing tests**

Add to `tests/runner.test.ts`:

```ts
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
  expect(selectCodexExecutionPlan(
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
  )).toEqual(["app-server"]);
});
```

- [ ] **Step 2: Run the tests and verify the first test fails**

Run:

```powershell
npm test -- tests/runner.test.ts --run
```

Expected: the app-server error path falls through to CLI in the current implementation.

- [ ] **Step 3: Implement fail-closed phone routing**

Add to `src/agent/runner.ts`:

```ts
function isPhoneConversationTask(task: TaskRecord): boolean {
  return task.source === "panel" && Boolean(task.conversationId);
}
```

Treat `isPhoneConversationTask(task)` the same as a desktop-synced task in the app-server catch and post-loop branches:

```ts
const requiresAppServer = isDesktopSyncedTask(task) || isPhoneConversationTask(task);
```

When `requiresAppServer` is true, return `desktopAppServerUnavailableResult(message)` and do not continue to any fallback.

Set both example configs to:

```json
"codexAppServer": { "enabled": true },
"desktopInput": { "enabled": false, "allowUnsafeForegroundRouting": false }
```

Preserve all existing properties in those objects.

- [ ] **Step 4: Run focused tests and build**

Run:

```powershell
npm test -- tests/runner.test.ts tests/config.test.ts --run
npm run build
```

Expected: tests PASS; build exits 0.

- [ ] **Step 5: Commit Task 4 files**

```powershell
git add src/agent/runner.ts tests/runner.test.ts config/dispatcher.config.example.json config/dispatcher.config.template.json
git commit -m "fix: keep phone conversations on app-server"
```

---

### Task 5: Make Win11 Agent Startup Compatible With the Current Codex App

**Files:**
- Modify: `scripts/watch-codex-start-agent.ps1`
- Modify: `scripts/setup-windows-agent.ps1`
- Modify: `tests/autostartScripts.test.ts`

**Interfaces:**
- Consumes: running Windows processes and the generated local agent config.
- Produces: hidden agent process starts when either current `ChatGPT.exe` Codex desktop or legacy `Codex.exe` desktop is open; generated config enables loopback app-server.

- [ ] **Step 1: Add failing watcher and generated-config assertions**

Extend `tests/autostartScripts.test.ts`:

```ts
it("recognizes ChatGPT.exe only inside the Codex Windows package", () => {
  const source = fs.readFileSync("scripts/watch-codex-start-agent.ps1", "utf8");
  expect(source).toContain("ChatGPT");
  expect(source).toContain("OpenAI.Codex_");
  expect(source).toContain("Test-CodexRunning");
});

it("generates an app-server-enabled Win11 agent config", () => {
  const source = fs.readFileSync("scripts/setup-windows-agent.ps1", "utf8");
  expect(source).toContain("codexAppServer");
  expect(source).toContain('url = "ws://127.0.0.1:18765"');
  expect(source).toContain("enabled = $true");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm test -- tests/autostartScripts.test.ts --run
```

Expected: FAIL because the watcher only checks process name `Codex` and setup does not emit `codexAppServer`.

- [ ] **Step 3: Match the desktop package path safely**

Replace `Test-CodexRunning` with a path-aware check:

```powershell
function Test-CodexRunning {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path -match "\\OpenAI\.Codex_[^\\]+\\app\\(ChatGPT|Codex)\.exe$"
  }).Count -gt 0
}
```

This deliberately ignores command-line `resources\codex.exe` processes.

- [ ] **Step 4: Generate complete app-server and safe desktop-input config**

Add to the `$config` object in `scripts/setup-windows-agent.ps1`:

```powershell
codexAppServer = [ordered]@{
  enabled = $true
  url = "ws://127.0.0.1:18765"
  startupTimeoutMs = 60000
  requestTimeoutMs = 30000
  turnTimeoutMs = 120000
  supervisorIntervalMs = 5000
  heartbeatIntervalMs = 10000
  refreshDesktopAfterTurn = $true
  refreshScriptPath = "scripts/refresh-codex-desktop.ps1"
  refreshWindowTitlePattern = "Codex|OpenAI|ChatGPT"
  refreshTimeoutMs = 8000
}
desktopInput = [ordered]@{
  enabled = $false
  allowUnsafeForegroundRouting = $false
  scriptPath = "scripts/send-codex-desktop-input.ps1"
  clickYOffset = 92
  windowTitlePattern = "Codex|OpenAI|ChatGPT"
  responseTimeoutMs = 180000
}
```

- [ ] **Step 5: Run script tests and parse-check both scripts**

Run:

```powershell
npm test -- tests/autostartScripts.test.ts --run
powershell -NoProfile -Command "$errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'scripts/watch-codex-start-agent.ps1'),[ref]$null,[ref]$errors); if($errors){$errors|ForEach-Object Message; exit 1}"
powershell -NoProfile -Command "$errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'scripts/setup-windows-agent.ps1'),[ref]$null,[ref]$errors); if($errors){$errors|ForEach-Object Message; exit 1}"
```

Expected: test PASS and both parser commands exit 0.

- [ ] **Step 6: Commit Task 5 files**

```powershell
git add scripts/watch-codex-start-agent.ps1 scripts/setup-windows-agent.ps1 tests/autostartScripts.test.ts
git commit -m "fix: auto-start agent with current Codex desktop"
```

---

### Task 6: Show Truthful Three-Layer Connection Status on the Phone

**Files:**
- Create: `public/connectionStatus.js`
- Create: `tests/connectionStatus.test.ts`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `capacitor.config.ts`
- Modify: `tests/panelUi.test.ts`
- Modify: `tests/staticAssets.test.ts`

**Interfaces:**
- Consumes: `/api/health` response with `services.nas`, `services.agents`, and `services.codex`.
- Produces: `deriveConnectionStatus(input)` returning `{ level: "online" | "recovering" | "offline"; label: string; detail: string }`.

- [ ] **Step 1: Write failing pure status tests**

Create `tests/connectionStatus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveConnectionStatus } from "../public/connectionStatus.js";

describe("deriveConnectionStatus", () => {
  it("reports online only when NAS, agent, and Codex are ready", () => {
    expect(deriveConnectionStatus({ nasReachable: true, onlineAgents: 1, readyCodex: 1 })).toEqual({
      level: "online",
      label: "已连接",
      detail: "NAS、电脑和 Codex 均可用"
    });
  });

  it("reports recovery when NAS is reachable but Codex is not ready", () => {
    expect(deriveConnectionStatus({ nasReachable: true, onlineAgents: 1, readyCodex: 0 })).toMatchObject({
      level: "recovering",
      label: "恢复中"
    });
  });

  it("reports offline only when NAS cannot be reached", () => {
    expect(deriveConnectionStatus({ nasReachable: false, onlineAgents: 0, readyCodex: 0 })).toMatchObject({
      level: "offline",
      label: "未连接"
    });
  });
});
```

- [ ] **Step 2: Add failing panel structure assertions**

Add to `tests/panelUi.test.ts`:

```ts
it("shows separate NAS, computer, and Codex connection details", () => {
  const html = fs.readFileSync("public/index.html", "utf8");
  const js = fs.readFileSync("public/app.js", "utf8");
  expect(html).toContain("connection-details");
  expect(html).toContain("NAS");
  expect(html).toContain("电脑");
  expect(html).toContain("Codex");
  expect(js).toContain("deriveConnectionStatus");
  expect(js).not.toContain('return "离线"');
});

it("disables Capacitor bridge logging so request credentials are not written to logcat", () => {
  const config = fs.readFileSync("capacitor.config.ts", "utf8");
  expect(config).toContain('loggingBehavior: "none"');
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
npm test -- tests/connectionStatus.test.ts tests/panelUi.test.ts --run
```

Expected: FAIL because the module and detail panel do not exist and the old window label still says `离线`.

- [ ] **Step 4: Implement pure status derivation**

Create `public/connectionStatus.js`:

```js
export function deriveConnectionStatus({ nasReachable, onlineAgents, readyCodex }) {
  if (!nasReachable) {
    return { level: "offline", label: "未连接", detail: "无法连接 NAS" };
  }
  if (onlineAgents < 1) {
    return { level: "recovering", label: "等待电脑", detail: "NAS 已连接，电脑代理未上线" };
  }
  if (readyCodex < 1) {
    return { level: "recovering", label: "恢复中", detail: "电脑在线，Codex 服务正在恢复" };
  }
  return { level: "online", label: "已连接", detail: "NAS、电脑和 Codex 均可用" };
}
```

- [ ] **Step 5: Wire the status into the existing header without moving chat controls**

Import `deriveConnectionStatus` at the top of `public/app.js`. Fetch `/api/health` in the existing refresh batch and use its `services` counts to call the pure helper. Update the existing computer status button to the derived label and `data-level` value.

Add a compact hidden detail panel in `public/index.html`:

```html
<div id="connection-details" class="connection-details" hidden>
  <div><span>NAS</span><strong id="nas-status">检查中</strong></div>
  <div><span>电脑</span><strong id="agent-status">检查中</strong></div>
  <div><span>Codex</span><strong id="codex-status">检查中</strong></div>
</div>
```

The header status button toggles this panel. Rename a stale bound-window label from `离线` to `窗口不可用` so it cannot be mistaken for computer connectivity.

Add restrained status styles:

```css
.connection-status[data-level="online"] { color: #147a4b; }
.connection-status[data-level="recovering"] { color: #9a6700; }
.connection-status[data-level="offline"] { color: #b42318; }
.connection-details { position: absolute; inset-inline-end: 12px; top: 100%; z-index: 30; width: min(280px, calc(100vw - 24px)); }
```

Keep card radius at 8px or less and do not change the fixed chat header or bottom composer geometry in Phase A.

- [ ] **Step 6: Disable native bridge request logging**

Add this top-level Capacitor property in `capacitor.config.ts`:

```ts
loggingBehavior: "none",
```

This Phase A mitigation stops the native bridge from printing `DispatcherHttp.request` arguments, including the token, in debug logcat. Secure credential storage remains a separate Phase D migration.

- [ ] **Step 7: Update cache-busting asset references**

Load the module and bump the existing query versions in `public/index.html`:

```html
<script type="module" src="/app.js?v=1.5.0"></script>
```

Because `app.js` imports `/connectionStatus.js`, ensure the server serves it with `Cache-Control: no-store`; extend `tests/staticAssets.test.ts` to request `/connectionStatus.js` and assert that header.

- [ ] **Step 8: Run UI tests and browser-level static checks**

Run:

```powershell
npm test -- tests/connectionStatus.test.ts tests/panelUi.test.ts tests/staticAssets.test.ts --run
npm run build
```

Expected: all tests PASS and build exits 0.

- [ ] **Step 9: Commit Task 6 files**

```powershell
git add public/connectionStatus.js public/app.js public/index.html public/styles.css capacitor.config.ts tests/connectionStatus.test.ts tests/panelUi.test.ts tests/staticAssets.test.ts
git commit -m "feat: show separate NAS agent and Codex status"
```

---

### Task 7: Integrate, Deploy, and Verify Phase A on Real Devices

**Files:**
- Modify: `android/app/build.gradle`
- Modify: `docs/CHANGELOG.zh-CN.md`
- Runtime-only: `config/dispatcher.config.json` (local secret-bearing config; do not commit)
- Runtime-only: NAS deployment files under `/home/leinas/openclaw-codex-dispatcher`.

**Interfaces:**
- Consumes: all Phase A behavior from Tasks 1-6.
- Produces: a deployed NAS service, restarted Win11 agent, WebDAV-published APK, and evidence for the Phase A acceptance subset.

- [ ] **Step 1: Run the full regression suite and build**

Run:

```powershell
npm test -- --run
npm run build
```

Expected: every test file passes with zero failures; TypeScript exits 0.

- [ ] **Step 2: Bump the Android package version and changelog**

Set in `android/app/build.gradle`:

```gradle
versionCode 37
versionName "1.5.0"
```

Set `appVersion = "1.5.0"` in `public/app.js` and add Chinese release notes describing truthful three-layer status, current Codex host recognition, app-server prewarming, and safe conversation routing. Add the same user-facing notes to `docs/CHANGELOG.zh-CN.md`.

- [ ] **Step 3: Update the local runtime config without printing credentials**

Modify only these fields in `config/dispatcher.config.json` using structured JSON editing:

```json
{
  "codexAppServer": {
    "enabled": true,
    "url": "ws://127.0.0.1:18765",
    "supervisorIntervalMs": 5000,
    "heartbeatIntervalMs": 10000
  },
  "desktopInput": {
    "enabled": false,
    "allowUnsafeForegroundRouting": false
  }
}
```

Preserve all tokens, project roots, and other existing fields. Do not print the resulting JSON.

- [ ] **Step 4: Restart only the OpenClaw Codex agent chain**

Stop the watcher and agent processes whose command lines contain `D:\aixm\openclaw`, then restart `scripts/watch-codex-start-agent.ps1` hidden. Do not close or reload unrelated Codex desktop windows.

Verify:

```powershell
Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 18765
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18765/readyz
```

Expected: loopback listener exists and `readyz` returns HTTP 200.

- [ ] **Step 5: Deploy NAS server files with a timestamped NAS-side backup**

Before replacing files on NAS, create `/home/leinas/openclaw-codex-dispatcher/backups/<timestamp>_phase_a_connection_core` containing only the files being replaced. Deploy the built server and public assets, restart the existing container, and verify:

```text
GET http://192.168.101.8:1314/api/health -> 200
services.agents.online -> 1
services.codex.ready -> 1
GET http://192.168.101.8:1314/connectionStatus.js -> 200 with Cache-Control: no-store
```

- [ ] **Step 6: Build and publish Android 1.5.0**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File D:\aixm\huanjing\build-capacitor-debug-apk.ps1 -ProjectRoot D:\aixm\openclaw -OutputName openclaw-codex-v1.5.0-37-debug.apk
powershell -ExecutionPolicy Bypass -File scripts\publish-android-webdav-update.ps1 -ApkPath .\release\openclaw-codex-v1.5.0-37-debug.apk -VersionCode 37 -VersionName 1.5.0 -Notes "修复 Codex 连接识别，增加 NAS、电脑、Codex 三层状态，并预热会话服务。" -Password $env:ANDROID_WEBDAV_UPDATE_PASSWORD
```

The shared WebDAV environment variables provide endpoint, username, password, and remote folder. The publisher must move the previous remote APK into `codexapp/history` before updating `update.json`.

Verify the remote manifest contains:

```json
{
  "versionCode": 37,
  "versionName": "1.5.0"
}
```

and verify the downloaded APK SHA-256 matches the manifest.

- [ ] **Step 7: Install on the currently connected Android device and run Phase A QA**

Use the active ADB transport for package `com.aixm.openclawcodex`. Install with replacement, launch `MainActivity`, and verify:

1. Header shows `已连接` only when NAS, agent, and Codex are all ready.
2. Killing the loopback app-server changes status to `恢复中`, then returns to `已连接` after recovery.
3. Opening the window picker lists the current `ChatGPT.exe` Codex window.
4. Sending a new phone-conversation message while app-server is deliberately unavailable fails visibly and does not appear in another desktop conversation.
5. Existing chat header remains fixed and the composer remains above the gesture safe area.
6. Android logcat does not contain the full dispatcher credential.

Capture one screenshot for healthy state and one for recovering state outside committed source.

- [ ] **Step 8: Run final regression and commit release metadata**

Run again after all version edits:

```powershell
npm test -- --run
npm run build
```

Expected: zero failures and build exit 0.

Commit only release metadata and any verified Phase A source changes not already committed:

```powershell
git add android/app/build.gradle public/app.js public/index.html docs/CHANGELOG.zh-CN.md
git commit -m "release: prepare mobile remote 1.5.0"
```

Do not mark the overall mobile-remote objective complete after Phase A. Phase B reliable realtime messaging, Phase C interaction redesign, Phase D credential hardening and 24-hour soak verification remain required by the approved design.

---

## Phase A Completion Evidence

Phase A is complete only when all of the following evidence exists from the current runtime:

- Full Vitest suite passes after all edits.
- TypeScript build succeeds after all edits.
- Current `ChatGPT.exe` Codex desktop window is discovered by the agent.
- Loopback `readyz` returns 200 before the first phone message.
- NAS health reports one online agent and one ready Codex service.
- A phone message to a selected conversation cannot fall back to CLI or desktop input.
- Android 1.5.0 is installed and shows distinct healthy/recovering states.
- WebDAV manifest and APK checksum are verified.
- No complete dispatcher credential appears in captured Android logcat.

## Later Plans Required by the Approved Design

After Phase A is verified, create separate plans for:

1. Phase B: phone WebSocket event stream, event cursor, message idempotency, reconnect reconciliation, and realtime approval notifications.
2. Phase C: conversation list, active-session switching, streaming message rendering, scroll preservation, composer/safe-area polish, and diagnostics UI.
3. Phase D: Android secure credential storage, redacted diagnostics export, startup/NAS recovery automation, update rollback, fault injection, and 24-hour soak test.
