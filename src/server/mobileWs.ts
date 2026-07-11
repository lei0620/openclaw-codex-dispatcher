import type http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { MobileClientMessage, MobileEvent, MobileServerMessage } from "../shared/types.js";
import type { TaskStore } from "./taskStore.js";

interface MobileWsDeps {
  server: http.Server;
  store: TaskStore;
  dispatcherToken: string;
}

export function attachMobileWebSocketServer({ server, store, dispatcherToken }: MobileWsDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const authenticatedClients = new Set<WebSocket>();
  const alive = new WeakMap<WebSocket, boolean>();

  server.on("upgrade", (request, socket, head) => {
    if (!request.url?.startsWith("/events")) {
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  const broadcast = (event: MobileEvent): void => {
    const message: MobileServerMessage = { type: "event", event };
    for (const ws of authenticatedClients) {
      send(ws, message);
    }
  };
  store.onMobileEvent(broadcast);

  wss.on("connection", (ws) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    const authenticationTimeout = setTimeout(() => ws.close(1008, "authentication timeout"), 5000);
    authenticationTimeout.unref();

    ws.once("message", (raw) => {
      const hello = parseMessage(raw);
      if (
        !hello ||
        hello.type !== "client.hello" ||
        hello.token !== dispatcherToken ||
        typeof hello.clientId !== "string" ||
        !hello.clientId.trim()
      ) {
        clearTimeout(authenticationTimeout);
        send(ws, { type: "error", message: "invalid client hello" });
        ws.close(1008, "invalid client hello");
        return;
      }

      clearTimeout(authenticationTimeout);
      authenticatedClients.add(ws);
      const hasCursor = Number.isInteger(hello.lastEventId) && Number(hello.lastEventId) >= 0;
      const eventWindow = hasCursor
        ? store.getMobileEventWindow(Number(hello.lastEventId))
        : { events: [], latestEventId: store.getLatestMobileEventId(), resetRequired: true };
      send(ws, {
        type: "client.accepted",
        latestEventId: eventWindow.latestEventId,
        resetRequired: eventWindow.resetRequired
      });
      if (eventWindow.resetRequired) {
        send(ws, {
          type: "sync.required",
          latestEventId: eventWindow.latestEventId,
          reason: hasCursor ? "expired_cursor" : "missing_cursor"
        });
      } else {
        for (const event of eventWindow.events) {
          send(ws, { type: "event", event });
        }
      }

      ws.on("message", (payload) => {
        const message = parseMessage(payload);
        if (message?.type === "client.ack" && Number.isInteger(message.eventId)) {
          alive.set(ws, true);
        }
      });
    });

    ws.on("close", () => {
      clearTimeout(authenticationTimeout);
      authenticatedClients.delete(ws);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 20000);
  heartbeat.unref();

  const cleanup = (): void => {
    clearInterval(heartbeat);
    store.offMobileEvent(broadcast);
  };
  wss.once("close", cleanup);
  server.once("close", () => {
    cleanup();
    wss.close();
  });

  return wss;
}

function parseMessage(raw: WebSocket.RawData): MobileClientMessage | undefined {
  try {
    return JSON.parse(raw.toString()) as MobileClientMessage;
  } catch {
    return undefined;
  }
}

function send(ws: WebSocket, message: MobileServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  if (ws.bufferedAmount > 1024 * 1024) {
    ws.close(1013, "client is too slow");
    return;
  }
  ws.send(JSON.stringify(message));
}
