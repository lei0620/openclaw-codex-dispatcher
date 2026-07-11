export interface WatchedTaskStatus {
  id: string;
  status: string;
  [key: string]: unknown;
}

export interface TaskStatusWatcherOptions {
  loadTask: (taskId: string) => Promise<WatchedTaskStatus | undefined>;
  onTask: (task: WatchedTaskStatus) => void;
  onError?: (error: unknown, taskId: string) => void;
  intervalMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export declare function createTaskStatusWatcher(options: TaskStatusWatcherOptions): {
  watch(taskId: string): void;
  stop(taskId: string): void;
  stopAll(): void;
};
