# Mobile Interaction Recovery Phase C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make routine phone use recover cleanly after backgrounding, preserve the user's reading position, expose active conversation state, and provide a non-technical diagnostics report.

**Architecture:** Keep the NAS WebSocket as the primary truth source. Add focused browser modules for lifecycle recovery and diagnostics, then let `public/app.js` bind those modules to existing state and UI. No task may silently resend a Codex turn during recovery.

**Tech Stack:** Browser ES modules, Capacitor WebView lifecycle events, Express/NAS APIs, Vitest, Android Capacitor packaging.

## Global Constraints

- Keep the current explicit `conversationId` routing and `clientMessageId` idempotency unchanged.
- A foreground resume may reconcile state but must never create or retry a task automatically.
- The message list must not jump while the user is reading history.
- Diagnostics must redact authorization tokens, passwords, WebDAV credentials, and 32- to 128-character secret-like hex strings.
- Only the three most recent conversations per project are loaded initially.

---

### Task 1: Lifecycle Recovery Controller

**Files:**
- Create: `public/lifecycleRecovery.js`
- Create: `public/lifecycleRecovery.d.ts`
- Modify: `public/app.js`
- Test: `tests/lifecycleRecovery.test.ts`

**Interfaces:**
- Produces: `createLifecycleRecovery({ reconcile, restartRealtime, now, minimumIntervalMs })` with `start()` and `stop()`.
- Consumes: browser `visibilitychange`, `online`, and `pageshow` events.

- [ ] Write failing tests proving hidden pages do nothing, visible resume reconciles once, rapid duplicate events are coalesced, and recovery never invokes a send callback.
- [ ] Run `npm test -- tests/lifecycleRecovery.test.ts --run` and confirm the missing module failure.
- [ ] Implement the controller with a 1-second minimum recovery interval and serialized reconciliation.
- [ ] Bind it after the initial snapshot; restart realtime first, then run `refresh()`.
- [ ] Run the focused test and `npm run build`.

### Task 2: Reading Position and New-Message Indicator

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Test: `tests/panelUi.test.ts`

**Interfaces:**
- Produces: `#jump-to-latest`, visible only when a new event changes the active conversation while the list is not near the bottom.

- [ ] Add failing UI-contract assertions for the button, unread class, and event-driven visibility.
- [ ] Run `npm test -- tests/panelUi.test.ts --run` and confirm failure.
- [ ] Add the compact floating button above the composer and preserve `scrollTop` during event renders.
- [ ] Clicking the button must request bottom scroll, render once, and clear the unread state.
- [ ] Run the focused UI tests and mobile viewport screenshot QA.

### Task 3: Conversation State Markers and Diagnostics

**Files:**
- Create: `public/diagnostics.js`
- Create: `public/diagnostics.d.ts`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Test: `tests/diagnostics.test.ts`
- Test: `tests/panelUi.test.ts`

**Interfaces:**
- Produces: `buildDiagnosticsSnapshot(input)` and `formatSanitizedDiagnostics(snapshot)`.
- Consumes: current health, realtime connection state, selected project/conversation, agents, Codex windows, pending approvals, and event cursor.

- [ ] Write failing tests for status labels and redaction of bearer tokens, password fields, WebDAV values, and long hex secrets.
- [ ] Implement deterministic snapshot formatting without reading browser storage directly.
- [ ] Add compact running, waiting-approval, and failed markers to conversation rows.
- [ ] Add a diagnostics section showing NAS latency, realtime state, Win11 heartbeat, Codex readiness, current conversation/thread IDs, and latest error.
- [ ] Add one-click copy/export of sanitized text and a visible success/failure result.
- [ ] Run diagnostics and panel tests plus `npm run build`.

### Task 4: Release and Runtime Verification

**Files:**
- Modify: `android/app/build.gradle`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `docs/CHANGELOG.zh-CN.md`

**Interfaces:**
- Produces: Android `1.7.0` with a WebDAV update manifest and deployed NAS assets.

- [ ] Run `npm test -- --run`, `npm run build`, and `git diff --check`.
- [ ] Back up only replaced NAS files, deploy assets, restart the container, and verify health plus `/events` authentication.
- [ ] Build APK `versionCode 39`, verify package metadata and SHA-256, then publish with old packages retained in WebDAV history.
- [ ] Verify a 360x780 viewport: fixed header/composer, non-overlapping diagnostics, and working jump-to-latest control.
- [ ] Commit and push source only; exclude APKs, screenshots, `artifacts/`, and `output/`.

## Self-Review

- Spec coverage: foreground recovery, reading-position preservation, active state markers, and diagnostics/export are covered. Native always-on background notifications and Keystore credential migration remain explicitly outside this phase and stay required for the overall objective.
- Placeholder scan: no deferred implementation placeholders are present.
- Type consistency: lifecycle and diagnostics interfaces are defined once and consumed by `public/app.js`.
