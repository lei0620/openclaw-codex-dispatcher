const activeStatuses = new Set(["queued", "running", "waiting_approval", "cancelling"]);

export function createTaskStatusWatcher(options) {
  const intervalMs = Number.isFinite(options.intervalMs) ? Math.max(100, options.intervalMs) : 1000;
  const setTimer = options.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimer = options.clearTimeoutFn ?? globalThis.clearTimeout;
  const watched = new Map();

  function watch(taskId) {
    if (!taskId || watched.has(taskId)) {
      return;
    }
    const entry = { stopped: false, timer: undefined };
    watched.set(taskId, entry);
    void poll(taskId, entry);
  }

  function stop(taskId) {
    const entry = watched.get(taskId);
    if (!entry) {
      return;
    }
    entry.stopped = true;
    if (entry.timer !== undefined) {
      clearTimer(entry.timer);
    }
    watched.delete(taskId);
  }

  function stopAll() {
    for (const taskId of [...watched.keys()]) {
      stop(taskId);
    }
  }

  async function poll(taskId, entry) {
    try {
      const task = await options.loadTask(taskId);
      if (entry.stopped || !task?.id) {
        return;
      }
      options.onTask(task);
      if (!activeStatuses.has(task.status)) {
        stop(taskId);
        return;
      }
    } catch (error) {
      if (entry.stopped) {
        return;
      }
      options.onError?.(error, taskId);
    }
    if (!entry.stopped) {
      entry.timer = setTimer(() => {
        entry.timer = undefined;
        void poll(taskId, entry);
      }, intervalMs);
    }
  }

  return { watch, stop, stopAll };
}
