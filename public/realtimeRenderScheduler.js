export function createRealtimeRenderScheduler(render, options = {}) {
  const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, options.delayMs) : 80;
  const setTimer = options.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimer = options.clearTimeoutFn ?? globalThis.clearTimeout;
  let timer;

  function schedule() {
    if (timer !== undefined) {
      return;
    }
    timer = setTimer(() => {
      timer = undefined;
      render();
    }, delayMs);
  }

  function cancel() {
    if (timer === undefined) {
      return;
    }
    clearTimer(timer);
    timer = undefined;
  }

  return { schedule, cancel };
}
