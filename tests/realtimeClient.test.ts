import { afterEach, describe, expect, it, vi } from "vitest";
import { createRealtimeClient } from "../public/realtimeClient.js";

afterEach(() => {
  vi.useRealTimers();
  FakeWebSocket.instances = [];
});

describe("createRealtimeClient", () => {
  it("keeps the token out of the URL and sends it only in client.hello", () => {
    let cursor: number | undefined = 7;
    const client = createClient({
      getLastEventId: () => cursor,
      setLastEventId: (value: number) => {
        cursor = value;
      }
    });

    client.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    expect(socket.url).toBe("ws://nas.local:1314/events");
    expect(socket.url).not.toContain("secret-token");
    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "client.hello",
      token: "secret-token",
      clientId: "phone-1",
      lastEventId: 7
    });
  });

  it("applies events in order and ignores duplicate event ids", async () => {
    let cursor: number | undefined = 4;
    const received: number[] = [];
    const client = createClient({
      getLastEventId: () => cursor,
      setLastEventId: (value: number) => {
        cursor = value;
      },
      onEvent: async (event: { eventId: number }) => {
        received.push(event.eventId);
      }
    });
    client.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.message({ type: "client.accepted", latestEventId: 4, resetRequired: false });
    socket.message({ type: "event", event: mobileEvent(5) });
    socket.message({ type: "event", event: mobileEvent(5) });
    socket.message({ type: "event", event: mobileEvent(6) });
    await client.whenIdle();

    expect(received).toEqual([5, 6]);
    expect(cursor).toBe(6);
    expect(socket.sent.map((item) => JSON.parse(item)).filter((item) => item.type === "client.ack")).toEqual([
      { type: "client.ack", eventId: 5 },
      { type: "client.ack", eventId: 6 }
    ]);
  });

  it("runs a full reconciliation when the server reports an expired cursor", async () => {
    let cursor: number | undefined = 2;
    const sync = vi.fn().mockResolvedValue(20);
    const client = createClient({
      getLastEventId: () => cursor,
      setLastEventId: (value: number) => {
        cursor = value;
      },
      onSyncRequired: sync
    });
    client.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.message({ type: "sync.required", latestEventId: 20, reason: "expired_cursor" });
    await client.whenIdle();

    expect(sync).toHaveBeenCalledWith({ latestEventId: 20, reason: "expired_cursor" });
    expect(cursor).toBe(20);
  });

  it("reconnects with backoff after an unexpected close", async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const client = createClient({ onState: (state: string) => states.push(state) });
    client.start();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].closeFromServer();

    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(states).toContain("reconnecting");
  });

  it("rotates to the next NAS address when the realtime connection drops", async () => {
    vi.useFakeTimers();
    const client = createClient({
      getApiBases: () => ["http://vpn-nas:1314", "http://lan-nas:1314"]
    });
    client.start();

    expect(FakeWebSocket.instances[0].url).toBe("ws://vpn-nas:1314/events");
    FakeWebSocket.instances[0].closeFromServer();
    await vi.advanceTimersByTimeAsync(1000);

    expect(FakeWebSocket.instances[1].url).toBe("ws://lan-nas:1314/events");
  });

  it("abandons a NAS address that never opens and tries the next one", async () => {
    vi.useFakeTimers();
    const client = createClient({
      getApiBases: () => ["http://vpn-nas:1314", "http://lan-nas:1314"],
      connectionTimeoutMs: 3000
    });
    client.start();

    await vi.advanceTimersByTimeAsync(3999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(FakeWebSocket.instances[1].url).toBe("ws://lan-nas:1314/events");
  });
});

function createClient(overrides: Record<string, unknown> = {}) {
  return createRealtimeClient({
    getApiBase: () => "http://nas.local:1314",
    getToken: () => "secret-token",
    clientId: "phone-1",
    getLastEventId: () => undefined,
    setLastEventId: () => undefined,
    onEvent: async () => undefined,
    onSyncRequired: async ({ latestEventId }: { latestEventId: number }) => latestEventId,
    onState: () => undefined,
    WebSocketImpl: FakeWebSocket,
    random: () => 0,
    ...overrides
  });
}

function mobileEvent(eventId: number) {
  return {
    eventId,
    type: "task.updated",
    occurredAt: new Date().toISOString(),
    taskId: "task-1",
    conversationId: "conversation-1",
    payload: { task: { id: "task-1" } }
  };
}

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  readyState = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(value: string): void {
    this.sent.push(value);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }

  closeFromServer(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}
