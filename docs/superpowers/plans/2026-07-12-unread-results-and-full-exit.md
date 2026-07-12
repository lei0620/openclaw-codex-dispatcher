# Unread Results And Full Exit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep completed results from other conversations visible as unread cards and provide a true Android full-exit action.

**Architecture:** Add a pure frontend unread-task state module backed by local storage and the existing `/api/tasks` snapshot. Add a small Capacitor Android plugin that disables the background service and exits the task/process; expose it from an Android-only generated power icon beside Settings.

**Tech Stack:** JavaScript ES modules, Vitest, Capacitor Android Java, Gradle, ADB.

## Global Constraints

- Existing project ordering, conversation synchronization, task execution, and notification behavior must remain unchanged.
- Historical terminal tasks that predate the first unread-state baseline must not become unread.
- Full exit must disable background notifications and stop `BackgroundRealtimeService` before ending the process.
- The full-exit control is Android-only, sits beside Settings, and requires confirmation.

---

### Task 1: Persistent unread task model

**Files:**
- Create: `public/unreadTasks.js`
- Create: `tests/unreadTasks.test.ts`

**Interfaces:**
- Produces: `createUnreadTaskStore(storage, options)` with `reconcile(tasks, context)`, `markConversationRead(conversationId, tasks)`, and `getUnreadTasks(tasks)`.

- [ ] **Step 1: Write failing tests** for first-run baseline, later terminal tasks, current-visible conversation auto-read, restart recovery, and conversation clearing.
- [ ] **Step 2: Run** `npm test -- --run tests/unreadTasks.test.ts` and confirm the module-missing failure.
- [ ] **Step 3: Implement** a local-storage record containing `baselineAt` and read task IDs; terminal statuses are `completed` and `failed`.
- [ ] **Step 4: Run** `npm test -- --run tests/unreadTasks.test.ts` and confirm all unread model tests pass.

### Task 2: Top cards include unread results

**Files:**
- Modify: `public/sidebarPriority.js`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/sidebarPriority.test.ts`
- Modify: `tests/panelUi.test.ts`

**Interfaces:**
- Consumes: `createUnreadTaskStore` from Task 1.
- Produces: `deriveAttentionConversations(projects, conversations, activeTasks, unreadTasks)` returning one card per conversation, with active tasks before unread terminal tasks.

- [ ] **Step 1: Write failing tests** for active/unread merge, one-card-per-conversation deduplication, and terminal labels.
- [ ] **Step 2: Run** the targeted sidebar and panel tests and confirm expected failures.
- [ ] **Step 3: Wire** `/api/tasks` snapshots and realtime `task.updated` events into the unread store; render “正在执行 / 待查看” and clear on card open.
- [ ] **Step 4: Add** compact completed/failed unread visual states without changing card dimensions.
- [ ] **Step 5: Run** targeted tests and confirm they pass.

### Task 3: Android full exit

**Files:**
- Create: `android/app/src/main/java/com/aixm/openclawcodex/AppExitPlugin.java`
- Modify: `android/app/src/main/java/com/aixm/openclawcodex/MainActivity.java`
- Modify: `android/app/src/main/java/com/aixm/openclawcodex/BackgroundRealtimeService.java`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Create: `tests/androidFullExit.test.ts`
- Modify: `tests/panelUi.test.ts`

**Interfaces:**
- Produces: Capacitor plugin `AppExit.exitCompletely()`.

- [ ] **Step 1: Write failing static tests** for plugin registration, Android-only button visibility, background preference disable, service stop, task removal, and process termination.
- [ ] **Step 2: Run** targeted tests and confirm expected failures.
- [ ] **Step 3: Implement** the generated top-bar power button, confirmation flow, and Android plugin.
- [ ] **Step 4: Run** targeted tests and confirm they pass.

### Task 4: Release and verification

**Files:**
- Modify: `android/app/build.gradle`
- Modify: `public/app.js`
- Modify: release manifest and generated APK outputs through existing scripts.

- [ ] **Step 1: Bump** to version `1.9.13` with version code `54` and user-facing release notes.
- [ ] **Step 2: Run** `npm test -- --run` and `npm run build`.
- [ ] **Step 3: Build** the Capacitor debug APK with the existing build script and install it over wireless ADB.
- [ ] **Step 4: Verify** on the connected phone that an off-screen conversation completion creates a persistent unread card and opening it clears the card.
- [ ] **Step 5: Verify** that confirming full exit leaves no App process and no `BackgroundRealtimeService`, then relaunch manually and confirm normal startup with background reminders disabled.
- [ ] **Step 6: Publish** the APK and update manifest to WebDAV, verify hashes, then commit and push only intended source/release metadata files.
