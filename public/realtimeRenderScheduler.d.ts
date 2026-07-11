export interface RealtimeRenderSchedulerOptions {
  delayMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export function createRealtimeRenderScheduler(
  render: () => void,
  options?: RealtimeRenderSchedulerOptions
): {
  schedule(): void;
  cancel(): void;
};
