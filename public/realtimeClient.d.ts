import type { MobileEvent } from "../src/shared/types.js";

export type RealtimeClientState = "stopped" | "connecting" | "reconnecting" | "syncing" | "online";

export interface RealtimeClientOptions {
  getApiBase(): string;
  getToken(): string;
  clientId: string;
  getLastEventId(): number | undefined;
  setLastEventId(value: number): void;
  onEvent(event: MobileEvent): void | Promise<void>;
  onSyncRequired(input: { latestEventId: number; reason: string }): number | void | Promise<number | void>;
  onState?(state: RealtimeClientState): void;
  WebSocketImpl?: any;
  random?: () => number;
}

export interface RealtimeClient {
  start(): void;
  stop(): void;
  restart(): void;
  whenIdle(): Promise<void>;
}

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient;
