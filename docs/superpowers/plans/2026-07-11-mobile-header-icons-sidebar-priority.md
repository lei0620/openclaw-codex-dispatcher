# Mobile Header Icons and Sidebar Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将移动端顶部固定为 Codex 品牌并换成统一生成式图标，同时让侧栏优先显示正在执行的对话和最近三个项目，且不改变现有会话绑定与同步行为。

**Architecture:** 新增一个无 DOM 依赖的侧栏派生模块，从现有 projects、conversations、activeTasks 计算最近项目和运行会话。现有 app.js 只负责渲染和事件绑定，NAS 接口、任务调度和 Codex 窗口绑定保持不变。生成式图标保存为独立透明 PNG，由 HTML 图片元素和 CSS 状态样式消费。

**Tech Stack:** Vanilla JavaScript ES modules, HTML, CSS, Vitest, Capacitor Android, generated PNG assets.

## Global Constraints

- 顶部主标题固定为 `Codex`。
- 图标源文件为六个独立 `192 x 192` 透明 PNG，显示尺寸为 `22-24px`。
- 侧栏顺序固定为 `正在执行`、`最近使用`、`全部项目`。
- 最近使用按 `updatedAt` 降序、按 `projectId` 去重，最多三个项目。
- 不修改 NAS API、鉴权、会话绑定、同窗口串行和不同窗口并行规则。
- 保留局域网优先与 Tailscale/VPN 备用连接。

---

### Task 1: Sidebar Priority Derivation

**Files:**
- Create: `public/sidebarPriority.js`
- Create: `public/sidebarPriority.d.ts`
- Create: `tests/sidebarPriority.test.ts`
- Modify: `public/app.js`

**Interfaces:**
- Produces: `deriveRecentProjects(projects, conversations, limit = 3)`，返回 `{ project, conversation }[]`。
- Produces: `deriveRunningConversations(projects, conversations, activeTasks)`，返回 `{ task, project, conversation }[]`，沿用输入任务顺序。
- Consumes: 现有项目、会话和任务对象，不修改对象本身。

- [ ] **Step 1: Write failing helper tests**

```ts
expect(deriveRecentProjects(projects, conversations).map((item) => item.project.id)).toEqual(["p2", "p1", "p3"]);
expect(deriveRecentProjects(projects, conversations, 2)).toHaveLength(2);
expect(deriveRunningConversations(projects, conversations, tasks)[0].conversation?.id).toBe("c2");
```

- [ ] **Step 2: Verify the tests fail because the module does not exist**

Run: `npx vitest run tests/sidebarPriority.test.ts`

Expected: FAIL resolving `/sidebarPriority.js`.

- [ ] **Step 3: Implement immutable derivation helpers**

```js
export function deriveRecentProjects(projects, conversations, limit = 3) {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const seen = new Set();
  return [...conversations]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .flatMap((conversation) => {
      if (seen.has(conversation.projectId)) return [];
      const project = projectsById.get(conversation.projectId);
      if (!project) return [];
      seen.add(conversation.projectId);
      return [{ project, conversation }];
    })
    .slice(0, Math.max(0, limit));
}
```

`deriveRunningConversations` 使用 Map 查找项目和会话，保留每个任务，即使关联会话尚未同步也能显示任务提示。

- [ ] **Step 4: Verify focused tests pass**

Run: `npx vitest run tests/sidebarPriority.test.ts`

Expected: all sidebar priority tests PASS.

- [ ] **Step 5: Commit helper and tests**

```powershell
git add public/sidebarPriority.js public/sidebarPriority.d.ts tests/sidebarPriority.test.ts
git commit -m "feat: derive priority sidebar sections"
```

### Task 2: Generated Header Icon Assets

**Files:**
- Create: `public/icons/menu.png`
- Create: `public/icons/window.png`
- Create: `public/icons/device.png`
- Create: `public/icons/sync.png`
- Create: `public/icons/approval.png`
- Create: `public/icons/settings.png`
- Modify: `tests/staticAssets.test.ts`

**Interfaces:**
- Produces: six transparent PNG files consumed through `/icons/<name>.png`.

- [ ] **Step 1: Add a failing static asset test**

```ts
for (const name of ["menu", "window", "device", "sync", "approval", "settings"]) {
  const file = fs.readFileSync(`public/icons/${name}.png`);
  expect(file.subarray(1, 4).toString()).toBe("PNG");
}
```

- [ ] **Step 2: Verify the test fails because icon files are absent**

Run: `npx vitest run tests/staticAssets.test.ts`

Expected: FAIL with missing `public/icons/menu.png`.

- [ ] **Step 3: Generate the six icon masters**

Use the built-in image generation tool with one prompt per icon. Each prompt requests a centered near-black line icon with emerald accent, generous padding, no text, no shadow, and a flat magenta chroma-key background. Remove the key with the installed imagegen helper and save each final alpha PNG at exactly `192 x 192`.

- [ ] **Step 4: Validate PNG dimensions and alpha**

Run a read-only image metadata check and require width `192`, height `192`, alpha channel present, and transparent corner pixels for all six files.

- [ ] **Step 5: Verify the asset test passes and commit**

```powershell
npx vitest run tests/staticAssets.test.ts
git add public/icons tests/staticAssets.test.ts
git commit -m "feat: add generated Codex mobile icons"
```

### Task 3: Header and Priority Sidebar UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/panelUi.test.ts`

**Interfaces:**
- Consumes: `deriveRecentProjects` and `deriveRunningConversations` from `/sidebarPriority.js`.
- Produces: sidebar sections with `data-sidebar-section="running|recent|all"` and icon images with class `topbar-icon`.

- [ ] **Step 1: Add failing panel assertions**

```ts
expect(html).toContain('<h2 id="current-project-name">Codex</h2>');
expect(html).toContain('src="/icons/menu.png"');
expect(js).toContain('deriveRecentProjects');
expect(js).toContain('data-sidebar-section="recent"');
expect(css).toContain('.sidebar-section-title');
```

- [ ] **Step 2: Verify panel tests fail on the old header and sidebar**

Run: `npx vitest run tests/panelUi.test.ts`

Expected: FAIL because title, icon assets, and priority sections are absent.

- [ ] **Step 3: Replace generated CSS marks with image elements**

Use `<img class="topbar-icon" src="/icons/menu.png" alt="" />` inside existing buttons. Preserve every button ID, listener, aria-label, title, expanded state, status class, and permission count element.

- [ ] **Step 4: Fix header title behavior**

`renderHeader()` always assigns `Codex` to `currentProjectName`; `conversationTitle` remains the compact current conversation title or empty-state guidance.

- [ ] **Step 5: Render three sidebar sections**

Build `正在执行` from sorted active tasks, `最近使用` from `deriveRecentProjects(..., 3)`, and `全部项目` from the existing `renderProjectGroup`. Reuse existing `data-project-id`, `data-conversation-id`, and `data-start-project-id` handlers so selection immediately updates the send target.

- [ ] **Step 6: Style fixed header and compact sections**

Use fixed 36/44px controls, 22-24px icon images, restrained black/gray surfaces, emerald active states, one-line title truncation, safe-area padding, and no nested decorative cards. Hide empty running/recent sections. Keep the mobile input fixed at the bottom.

- [ ] **Step 7: Verify focused and full tests pass**

Run: `npx vitest run tests/panelUi.test.ts tests/sidebarPriority.test.ts tests/staticAssets.test.ts`

Run: `npm test`

Expected: focused tests PASS and the full suite remains green.

- [ ] **Step 8: Commit UI integration**

```powershell
git add public/index.html public/app.js public/styles.css tests/panelUi.test.ts
git commit -m "feat: prioritize mobile Codex conversations"
```

### Task 4: Visual QA, Android Build, and Release

**Files:**
- Modify: `public/app.js` for version and release notes
- Modify: `android/app/build.gradle`
- Modify: `docs/CHANGELOG.zh-CN.md`
- Synchronize: `android/app/src/main/assets/public/`

**Interfaces:**
- Produces: a new Android APK, WebDAV update metadata, NAS frontend deployment, and GitHub source update.

- [ ] **Step 1: Run browser visual QA at phone and desktop sizes**

Check `390 x 844` and `1440 x 900`: all six top controls visible, title not overlapping, sidebar order correct, no excessive gaps, message pane scrolls, and input remains bottom-aligned.

- [ ] **Step 2: Exercise interaction paths**

Open/close sidebar; switch running conversation; switch recent project; open window picker, permissions, and settings; trigger sync; verify active conversation ID changes before send; verify other running windows are not refreshed.

- [ ] **Step 3: Bump release metadata**

Increase Android `versionCode` by one and patch version to `1.9.7`; set concise Chinese release notes covering Codex header, unified icons, and running/recent sidebar priority; append the same facts to the changelog.

- [ ] **Step 4: Prepare and build Android assets**

Copy the tested public frontend into Capacitor assets, remove bundled downloads, build with the configured JDK 21 environment, and run the complete unit suite before accepting the APK.

- [ ] **Step 5: Install and inspect on the paired phone**

Use the currently connected wireless ADB device. Preserve app data, install the new APK, launch it, and capture a screenshot proving the new header and sidebar sections render on the real device.

- [ ] **Step 6: Publish with history retention**

Archive the previous APK in the WebDAV history folder, publish the new APK and update metadata, verify SHA-256, back up the NAS frontend files being replaced, deploy the new frontend, and verify LAN and VPN endpoints.

- [ ] **Step 7: Final verification and source push**

Run `git diff --check`, `npm test`, `npm run build`, inspect `git status`, commit only source/config/docs needed for this release, and push `main` to GitHub.
