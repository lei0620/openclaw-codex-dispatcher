export interface LifecycleRecoveryOptions {
  reconcile: () => Promise<unknown>;
  restartRealtime: () => void;
  documentTarget?: EventTarget & { visibilityState?: string };
  windowTarget?: EventTarget;
  now?: () => number;
  minimumIntervalMs?: number;
}

export function createLifecycleRecovery(options: LifecycleRecoveryOptions): {
  start(): void;
  stop(): void;
  whenIdle(): Promise<unknown>;
};
