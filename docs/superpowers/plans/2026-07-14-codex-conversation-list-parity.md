# Codex Conversation List Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the phone's five recent conversations per project match Codex desktop ordering while reducing Win11 sync work.

**Architecture:** Add a read-only Codex thread metadata adapter that reads `state_5.sqlite`, filters archived threads, and selects five threads per project by desktop recency. Keep `session_index.jsonl` as the display-title source and retain the existing rollout-file scanner as a fallback when the database is unavailable.

**Tech Stack:** TypeScript 5.7, Node.js 22 `node:sqlite`, Vitest 4, existing WebSocket agent sync.

---

### Task 1: Reproduce Desktop Ordering And Archive Filtering

**Files:**
- Modify: `tests/codexSessions.test.ts`
- Test: `tests/codexSessions.test.ts`

- [ ] **Step 1: Add a state database test fixture**

Create a temporary `state_5.sqlite` with the Codex `threads` columns used by the agent. Insert six unarchived threads and one archived thread. Give `session-2` a stale `session_index.jsonl` timestamp but the second-newest `recency_at_ms`, and give the archived thread the newest recency.

```ts
const database = new DatabaseSync(path.join(tmp, "state_5.sqlite"));
database.exec(`
  CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    cwd TEXT NOT NULL,
    title TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    updated_at_ms INTEGER,
    recency_at_ms INTEGER
  )
`);
```

- [ ] **Step 2: Assert desktop-visible order and title behavior**

```ts
expect(readRecentCodexConversations(projects).map(({ sessionId, title }) => ({ sessionId, title }))).toEqual([
  { sessionId: "session-1", title: "桌面标题 1" },
  { sessionId: "session-2", title: "配置飞牛NAS源" },
  { sessionId: "session-3", title: "桌面标题 3" },
  { sessionId: "session-4", title: "桌面标题 4" },
  { sessionId: "session-5", title: "桌面标题 5" }
]);
```

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/codexSessions.test.ts`

Expected: FAIL because the current implementation sorts by the stale session index/file timestamp and does not read desktop recency or archived state.

- [ ] **Step 4: Commit the failing test only after recording RED evidence**

Run:

```powershell
git add tests/codexSessions.test.ts
git commit -m "test: reproduce Codex conversation ordering drift"
```

### Task 2: Add The Read-Only Desktop Thread Metadata Adapter

**Files:**
- Modify: `src/agent/codexSessions.ts`
- Test: `tests/codexSessions.test.ts`

- [ ] **Step 1: Read Codex thread metadata without writing the database**

Use `DatabaseSync` with `{ readOnly: true }`. Query only unarchived rows and convert the desktop recency value to ISO time. Any missing database, unsupported schema, or SQLite failure must return `undefined` so the legacy scanner remains available.

```ts
interface CodexThreadState {
  sessionId: string;
  cwd: string;
  recencyAt: string;
}
```

- [ ] **Step 2: Normalize Windows device-prefixed paths**

Before `path.resolve`, remove the `\\?\` prefix used by the Codex database so `\\?\D:\aixm\对话` matches the discovered project path `D:/aixm/对话`.

```ts
const withoutDevicePrefix = value.replace(/^\\\\\?\\/, "");
```

- [ ] **Step 3: Select five threads per project before reading rollout files**

Map metadata to projects, sort by `recencyAt`, take the configured limit for each project, and parse only rollout files whose filename contains a selected session id. Override parsed `updatedAt` with desktop recency while retaining the session-index title.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/codexSessions.test.ts`

Expected: all `codexSessions` tests pass, including the new desktop-order regression.

- [ ] **Step 5: Run TypeScript build**

Run: `npm run build`

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 6: Commit implementation**

Run:

```powershell
git add src/agent/codexSessions.ts tests/codexSessions.test.ts
git commit -m "fix: match Codex desktop conversation order"
```

### Task 3: Verify Performance And Live Three-Side Consistency

**Files:**
- Modify: `docs/CHANGELOG.zh-CN.md`

- [ ] **Step 1: Benchmark real Win11 conversation sync**

Run `readRecentCodexConversations(discoverProjects(...))` against the current Codex home and record elapsed time and the five `D:\aixm\对话` titles.

Expected: “配置飞牛NAS源” is second, no archived thread appears, and elapsed time is below the 2.5-second sync period.

- [ ] **Step 2: Run full verification**

Run:

```powershell
npm test
npm run build
git diff --check
```

Expected: all tests pass, build exits 0, and diff check reports no errors.

- [ ] **Step 3: Restart the Win11 agent and trigger NAS synchronization**

Restart only the OpenClaw Win11 agent process, leaving other Codex windows and tasks untouched. Call `POST /api/conversations/sync`, then query the NAS recent five for project `D:/aixm/对话`.

Expected: the NAS order matches the desktop order and includes “配置飞牛NAS源”.

- [ ] **Step 4: Verify the connected Android app**

Refresh/sync the phone through ADB, inspect the UI hierarchy or screenshot, and confirm the target conversation appears in the `对话` project without changing window bindings or task state.

- [ ] **Step 5: Document the user-visible change**

Add a changelog entry explaining that phone conversation ordering now follows Codex desktop activity, archived conversations no longer consume recent slots, and Win11 synchronization does less background file work.

- [ ] **Step 6: Commit, push, and report residual findings**

Commit the changelog, push `main`, and report only evidence-backed remaining optimization opportunities. Do not include `artifacts/` or `output/`.
