# Android Keystore Connection Phase D1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the NAS dispatcher token and service address from Android WebView localStorage while preserving seamless upgrades from existing installations.

**Architecture:** Add a Capacitor `SecureConnection` plugin backed by Android Keystore AES-GCM and private SharedPreferences. A small browser module selects the native store on Android, migrates legacy localStorage exactly once, and keeps localStorage only as the browser-panel fallback.

**Tech Stack:** Java Android Keystore, Capacitor Plugin API, browser ES modules, Vitest, Gradle.

## Global Constraints

- Never log, return in an error message, or persist the dispatcher token outside encrypted Android storage.
- Upgrading an existing installation must preserve its current token and API base without asking the user to re-enter them.
- After successful Android migration, remove `openclawToken` and `openclawApiBase` from WebView localStorage.
- Browser access to the NAS panel keeps localStorage fallback because Android Keystore is unavailable there.
- Failure to decrypt must reject explicitly and must not overwrite the encrypted value with an empty token.

---

### Task 1: Storage Adapter Contract

**Files:**
- Create: `public/connectionSettings.js`
- Create: `public/connectionSettings.d.ts`
- Create: `tests/connectionSettings.test.ts`

**Interfaces:**
- Produces: `createConnectionSettingsStore({ nativeStore, localStorage, defaultApiBase })`.
- Produces methods: `load(): Promise<{ token: string; apiBase: string; storage: "native" | "browser" }>` and `save({ token, apiBase }): Promise<void>`.

- [ ] Write failing tests for native load, legacy migration, localStorage removal after migration, browser fallback, save, and native rejection without destructive fallback.
- [ ] Run the focused test and confirm the module is missing.
- [ ] Implement the minimal adapter and rerun the tests.
- [ ] Add the asset to static no-cache tests and run `npm run build`.

### Task 2: Android SecureConnection Plugin

**Files:**
- Create: `android/app/src/main/java/com/aixm/openclawcodex/SecureConnectionPlugin.java`
- Modify: `android/app/src/main/java/com/aixm/openclawcodex/MainActivity.java`
- Create: `tests/androidSecureConnection.test.ts`

**Interfaces:**
- Capacitor methods: `load()`, `save({ token, apiBase })`, and `clear()`.
- Storage: private preference file `openclaw_secure_connection`; AES-GCM key alias `openclaw_dispatcher_connection_key`.

- [ ] Write source-contract tests for plugin registration, AndroidKeyStore, AES/GCM/NoPadding, private preferences, encrypted token writes, and absence of token logging.
- [ ] Run tests and confirm failure.
- [ ] Implement key creation, 12-byte IV payload encoding, authenticated decrypt, normalized API base, and plugin methods.
- [ ] Run source-contract tests and Gradle `assembleDebug`.

### Task 3: App Migration and Settings Integration

**Files:**
- Modify: `public/app.js`
- Modify: `tests/panelUi.test.ts`

**Interfaces:**
- Consumes `window.Capacitor?.Plugins?.SecureConnection` and the Task 1 adapter.

- [ ] Add failing assertions that Android startup awaits secure settings before the first refresh and that save/reset paths call the adapter rather than writing dispatcher credentials directly.
- [ ] Replace synchronous credential initialization with `await connectionSettings.load()` before form initialization.
- [ ] Make save/reset functions async, persist through the adapter, then refresh and restart realtime.
- [ ] Verify non-credential UI preferences still use localStorage.
- [ ] Run panel, adapter, static asset tests and `npm run build`.

### Task 4: Release and Verification

**Files:**
- Modify: `android/app/build.gradle`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `docs/CHANGELOG.zh-CN.md`

**Interfaces:**
- Produces Android `1.8.0`, `versionCode 40`.

- [ ] Run all tests, TypeScript build, diff check, and secret scan.
- [ ] Deploy changed public assets to NAS after timestamped backup and verify browser fallback still connects.
- [ ] Build APK with WebDAV defaults injected only into the build process; verify metadata and SHA-256.
- [ ] Publish to WebDAV with old packages retained and verify manifest/hash remotely.
- [ ] Commit and push source only; exclude APKs, screenshots, `artifacts/`, and `output/`.

## Self-Review

- Spec coverage: dispatcher credentials leave WebView localStorage on Android; browser fallback and seamless migration are explicit.
- Failure behavior: native decrypt errors reject and preserve ciphertext.
- Scope: background native notifications and 24-hour soak verification remain separate follow-up work for the overall objective.
- Placeholder scan: no deferred implementation placeholders are present.
