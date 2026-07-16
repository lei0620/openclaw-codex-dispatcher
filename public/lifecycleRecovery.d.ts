export interface LifecycleRecoveryOptions {
  reconcile: () => Promise<unknown>;
  restartRealtime: () => void;
  nativeApp?: {
    addListener(
      eventName: "resume" | "appStateChange",
      listener: (payload?: { isActive?: boolean }) => unknown
    ): Promise<{ remove(): Promise<void> | void }> | { remove(): Promise<void> | void };
  };
  documentTarget?: EventTarget & { visibilityState?: string };
  windowTarget?: EventTarget;
  now?: () => number;
  minimumIntervalMs?: number;
}

export function createLifecycleRecovery(options: LifecycleRecoveryOptions): {
  start(): void;
  stop(): Promise<void>;
  whenIdle(): Promise<unknown>;
  isActive(): boolean;
};
