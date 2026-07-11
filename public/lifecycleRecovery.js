export function createLifecycleRecovery(options) {
  const documentTarget = options.documentTarget ?? globalThis.document;
  const windowTarget = options.windowTarget ?? globalThis.window;
  const now = options.now ?? Date.now;
  const minimumIntervalMs = options.minimumIntervalMs ?? 1000;
  let started = false;
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let processing = Promise.resolve();

  function isVisible() {
    return documentTarget?.visibilityState !== "hidden";
  }

  function recover() {
    if (!isVisible()) return;
    const startedAt = now();
    if (startedAt - lastStartedAt < minimumIntervalMs) return;
    lastStartedAt = startedAt;
    options.restartRealtime();
    processing = processing.then(() => options.reconcile()).catch(() => undefined);
  }

  function onVisibilityChange() {
    recover();
  }

  function start() {
    if (started) return;
    started = true;
    documentTarget?.addEventListener("visibilitychange", onVisibilityChange);
    windowTarget?.addEventListener("online", recover);
    windowTarget?.addEventListener("pageshow", recover);
  }

  function stop() {
    if (!started) return;
    started = false;
    documentTarget?.removeEventListener("visibilitychange", onVisibilityChange);
    windowTarget?.removeEventListener("online", recover);
    windowTarget?.removeEventListener("pageshow", recover);
  }

  return { start, stop, whenIdle: () => processing };
}
