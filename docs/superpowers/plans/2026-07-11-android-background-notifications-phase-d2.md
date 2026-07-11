# Android Background Notifications Phase D2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a user-enabled native NAS event connection alive while the Android app is locked or backgrounded and surface approval/completion events as system notifications.

**Architecture:** A `remoteMessaging` foreground service maintains its own authenticated WebSocket and event cursor, separate from the WebView client. It reads dispatcher credentials through the existing Keystore store, posts notifications only while the app is not foreground, and resumes after process or device restart when the user-enabled preference remains true.

**Tech Stack:** Android foreground service, OkHttp WebSocket, Android notification channels, Capacitor plugin permissions, Vitest source contracts, Gradle.

## Global Constraints

- The service may notify only; it must never create, retry, cancel, approve, or deny a task.
- Notification clicks open the app and leave the existing permission inbox as the only approval UI.
- Use foreground service type `remoteMessaging` and request `POST_NOTIFICATIONS` on Android 13+ from a user action.
- Keep a separate background client ID and event cursor so the WebView cursor remains authoritative for UI rendering.
- Suppress approval/completion popups while `MainActivity` is foreground to avoid duplicate alerts.
- Reconnect at 1, 2, 5, 10, then 30 seconds and never include the token in a URL or log.

---

### Task 1: Shared Secure Connection Store

**Files:**
- Create: `android/app/src/main/java/com/aixm/openclawcodex/SecureConnectionStore.java`
- Modify: `android/app/src/main/java/com/aixm/openclawcodex/SecureConnectionPlugin.java`
- Modify: `tests/androidSecureConnection.test.ts`

**Interfaces:**
- Produces: `SecureConnectionStore.load(Context)` and `save(Context, token, apiBase)` returning a package-private `Settings` value.

- [ ] Extend source-contract tests to require a shared store and forbid duplicate Keystore aliases.
- [ ] Extract existing AES-GCM implementation without changing ciphertext format or preference names.
- [ ] Compile Android Java and rerun secure storage tests.

### Task 2: Background Realtime Foreground Service

**Files:**
- Create: `android/app/src/main/java/com/aixm/openclawcodex/BackgroundRealtimeService.java`
- Create: `android/app/src/main/java/com/aixm/openclawcodex/AppVisibility.java`
- Modify: `android/app/build.gradle`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/java/com/aixm/openclawcodex/MainActivity.java`
- Create: `tests/androidBackgroundNotifications.test.ts`

**Interfaces:**
- WebSocket path: `/events`; hello type `client.hello`; client ID prefix `android-background:`.
- Preferences: `openclaw_background_realtime`, keys `enabled` and `last_event_id`.

- [ ] Write failing source-contract tests for remoteMessaging permissions/type, OkHttp WebSocket, foreground notification, token-in-frame authentication, cursor persistence, reconnect delays, foreground suppression, and no task-mutating endpoints.
- [ ] Add OkHttp `4.12.0`, service channels, persistent connection notification, event parser, approval/completion notifications, and bounded reconnect.
- [ ] Compile and run the focused tests.

### Task 3: Permission Plugin and Boot Recovery

**Files:**
- Create: `android/app/src/main/java/com/aixm/openclawcodex/BackgroundNotificationsPlugin.java`
- Create: `android/app/src/main/java/com/aixm/openclawcodex/BootCompletedReceiver.java`
- Modify: `android/app/src/main/java/com/aixm/openclawcodex/MainActivity.java`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Test: `tests/androidBackgroundNotifications.test.ts`

**Interfaces:**
- Capacitor methods: `status()`, `enable()`, `disable()`.
- Produces `{ enabled: boolean, permission: "granted" | "denied" | "prompt" }`.

- [ ] Add failing tests for plugin registration, runtime permission request, explicit user enable, disable, BOOT_COMPLETED receiver, and persisted enabled state.
- [ ] Implement permission callback, service start/stop, receiver restart, and status response.
- [ ] Compile and rerun tests.

### Task 4: Settings UI and Release

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/panelUi.test.ts`
- Modify: `android/app/build.gradle`
- Modify: `docs/CHANGELOG.zh-CN.md`

**Interfaces:**
- Settings toggle ID: `background-notifications`; status ID: `background-notifications-status`.
- Produces Android `1.9.0`, `versionCode 41`.

- [ ] Add failing UI tests for the toggle, permission state, native-only visibility, and no browser prompt.
- [ ] Bind enable/disable/status to the native plugin and show clear Chinese results for granted, denied, and missing credentials.
- [ ] Run all tests, TypeScript build, Gradle assemble, diff check, and secret scan.
- [ ] Deploy public assets to NAS, build/publish APK, verify metadata and remote hash, then commit/push source only.

## Self-Review

- Official Android alignment: `remoteMessaging` is used for cross-device text continuity; `POST_NOTIFICATIONS` is requested from the settings toggle; the foreground notification remains mandatory.
- Safety: no notification action can approve or mutate a task.
- Recovery: service uses `START_STICKY`, a persisted enabled flag, package-replaced/boot receiver, and a separate replay cursor.
- Missing evidence: true lock-screen delivery and reboot recovery still require an attached physical phone and remain unproven until ADB is available.
- Placeholder scan: no deferred implementation placeholders are present.
