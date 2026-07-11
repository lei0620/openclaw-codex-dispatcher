import http from "node:http";
import { AddressInfo } from "node:net";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { attachMobileWebSocketServer } from "../src/server/mobileWs.js";
import { TaskStore } from "../src/server/taskStore.js";

let server: http.Server | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.terminate();
  }
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

describe("mobile realtime websocket", () => {
  it("authenticates and replays ordered events after lastEventId", async () => {
    const store = new TaskStore();
    const conversation = store.createConversation({ projectId: "openclaw", title: "重连补发" });
    const cursor = store.getLatestMobileEventId();
    const task = store.createTask({
      projectId: "openclaw",
      conversationId: conversation.id,
      prompt: "补发这条",
      mode: "codex",
      source: "panel",
      clientMessageId: "phone-ws-replay-1"
    });
    const ws = await connect(store);
    const messages = collectMessages(ws, 2);

    ws.send(JSON.stringify({
      type: "client.hello",
      token: "panel-token",
      clientId: "phone-1",
      lastEventId: cursor
    }));

    await expect(messages).resolves.toMatchObject([
      { type: "client.accepted", resetRequired: false },
      { type: "event", event: { type: "task.created", taskId: task.id } }
    ]);
  });

  it("broadcasts new task events without waiting for polling", async () => {
    const store = new TaskStore();
    const conversation = store.createConversation({ projectId: "openclaw", title: "实时推送" });
    const ws = await connect(store);
    ws.send(JSON.stringify({
      type: "client.hello",
      token: "panel-token",
      clientId: "phone-1",
      lastEventId: store.getLatestMobileEventId()
    }));
    await onceMessage(ws);
    const liveEvent = onceMessage(ws);

    const task = store.createTask({
      projectId: "openclaw",
      conversationId: conversation.id,
      prompt: "立即显示",
      mode: "codex",
      source: "panel",
      clientMessageId: "phone-ws-live-1"
    });

    await expect(liveEvent).resolves.toMatchObject({
      type: "event",
      event: { type: "task.created", taskId: task.id }
    });
  });

  it("requires a full sync for a new client without a cursor", async () => {
    const store = new TaskStore();
    store.createConversation({ projectId: "openclaw", title: "首次连接" });
    const ws = await connect(store);
    const messages = collectMessages(ws, 2);

    ws.send(JSON.stringify({ type: "client.hello", token: "panel-token", clientId: "phone-new" }));

    await expect(messages).resolves.toMatchObject([
      { type: "client.accepted", resetRequired: true },
      { type: "sync.required", reason: "missing_cursor" }
    ]);
  });

  it("rejects an invalid dispatcher token", async () => {
    const ws = await connect(new TaskStore());
    const response = onceMessage(ws);

    ws.send(JSON.stringify({ type: "client.hello", token: "wrong", clientId: "phone-1" }));

    await expect(response).resolves.toMatchObject({ type: "error", message: "invalid client hello" });
  });

  it("rejects a malformed hello without crashing the server", async () => {
    const ws = await connect(new TaskStore());
    const response = onceMessage(ws);

    ws.send(JSON.stringify({ type: "client.hello", token: "panel-token" }));

    await expect(response).resolves.toMatchObject({ type: "error", message: "invalid client hello" });
  });
});

async function connect(store: TaskStore): Promise<WebSocket> {
  server = http.createServer();
  attachMobileWebSocketServer({ server, store, dispatcherToken: "panel-token" });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/events`);
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return ws;
}

function onceMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    ws.once("error", reject);
  });
}

function collectMessages(ws: WebSocket, count: number): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const messages: any[] = [];
    const timeout = setTimeout(() => reject(new Error("timed out waiting for mobile events")), 1000);
    ws.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()));
      if (messages.length === count) {
        clearTimeout(timeout);
        resolve(messages);
      }
    });
    ws.once("error", reject);
  });
}
