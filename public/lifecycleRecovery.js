export function createLifecycleRecovery(options) {
  const documentTarget = options.documentTarget ?? globalThis.document;
  const windowTarget = options.windowTarget ?? globalThis.window;
  const nativeApp = options.nativeApp;
  const now = options.now ?? Date.now;
  const minimumIntervalMs = options.minimumIntervalMs ?? 1000;
  let started = false;
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let processing = Promise.resolve();
  let nativeListenerHandles = [];
  let nativeRegistration = Promise.resolve();

  function isVisible() {
    return documentTarget?.visibilityState !== "hidden";
  }

  function recover({ assumeVisible = false } = {}) {
    if (!assumeVisible && !isVisible()) return;
    const startedAt = now();
    if (startedAt - lastStartedAt < minimumIntervalMs) return;
    lastStartedAt = startedAt;
    options.restartRealtime();
    processing = processing.then(() => options.reconcile()).catch(() => undefined);
  }

  function onVisibilityChange() {
    recover();
  }

  function registerNativeListeners() {
    if (!nativeApp?.addListener) return;
    nativeRegistration = Promise.allSettled([
      Promise.resolve().then(() => nativeApp.addListener("resume", () => recover({ assumeVisible: true }))),
      Promise.resolve().then(() => nativeApp.addListener("appStateChange", ({ isActive } = {}) => {
        if (isActive) recover({ assumeVisible: true });
      }))
    ]).then(async (results) => {
      const handles = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
      if (!started) {
        await Promise.all(handles.map((handle) => handle?.remove?.()));
        return;
      }
      nativeListenerHandles = handles;
    });
  }

  function start() {
    if (started) return;
    started = true;
    documentTarget?.addEventListener("visibilitychange", onVisibilityChange);
    windowTarget?.addEventListener("online", recover);
    windowTarget?.addEventListener("pageshow", recover);
    registerNativeListeners();
  }

  async function stop() {
    if (!started) return;
    started = false;
    documentTarget?.removeEventListener("visibilitychange", onVisibilityChange);
    windowTarget?.removeEventListener("online", recover);
    windowTarget?.removeEventListener("pageshow", recover);
    await nativeRegistration;
    const handles = nativeListenerHandles;
    nativeListenerHandles = [];
    await Promise.all(handles.map((handle) => handle?.remove?.()));
  }

  return { start, stop, whenIdle: () => processing };
}
