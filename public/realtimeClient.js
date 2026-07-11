const reconnectDelays = [1000, 2000, 5000, 10000, 30000];

export function createRealtimeClient(options) {
  const WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  const random = options.random ?? Math.random;
  let socket;
  let reconnectTimer;
  let connectionTimer;
  let reconnectAttempt = 0;
  let apiBaseIndex = 0;
  let stopped = true;
  let processing = Promise.resolve();

  function start() {
    if (!stopped) return;
    stopped = false;
    connect();
  }

  function stop() {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (connectionTimer) clearTimeout(connectionTimer);
    reconnectTimer = undefined;
    connectionTimer = undefined;
    if (socket) {
      const current = socket;
      socket = undefined;
      current.onclose = undefined;
      current.close();
    }
    setState("stopped");
  }

  function restart() {
    stop();
    reconnectAttempt = 0;
    apiBaseIndex = 0;
    start();
  }

  function whenIdle() {
    return processing;
  }

  function connect() {
    if (stopped) return;
    const apiBases = getApiBases();
    const apiBase = apiBases[apiBaseIndex % Math.max(apiBases.length, 1)] ?? "";
    const token = String(options.getToken() ?? "");
    if (!apiBase || !token || !WebSocketImpl) {
      setState("stopped");
      return;
    }
    setState(reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const current = new WebSocketImpl(toWebSocketUrl(apiBase));
    socket = current;
    connectionTimer = setTimeout(() => {
      if (socket !== current || current.readyState === WebSocketImpl.OPEN) return;
      current.onclose = undefined;
      socket = undefined;
      current.close();
      advanceApiBase(apiBases.length);
      scheduleReconnect();
    }, options.connectionTimeoutMs ?? 5000);
    current.onopen = () => {
      clearConnectionTimer();
      const lastEventId = options.getLastEventId();
      current.send(JSON.stringify({
        type: "client.hello",
        token,
        clientId: options.clientId,
        ...(Number.isInteger(lastEventId) && lastEventId >= 0 ? { lastEventId } : {})
      }));
    };
    current.onmessage = (message) => {
      processing = processing
        .then(() => handleMessage(JSON.parse(String(message.data))))
        .catch(() => {
          current.close();
        });
    };
    current.onerror = () => undefined;
    current.onclose = () => {
      if (socket !== current) return;
      clearConnectionTimer();
      socket = undefined;
      if (!stopped) {
        advanceApiBase(apiBases.length);
        scheduleReconnect();
      }
    };
  }

  function getApiBases() {
    const configured = options.getApiBases?.() ?? [options.getApiBase?.()];
    return [...new Set(configured.map((value) => String(value ?? "").replace(/\/$/, "")).filter(Boolean))];
  }

  function advanceApiBase(length) {
    if (length > 1) apiBaseIndex = (apiBaseIndex + 1) % length;
  }

  function clearConnectionTimer() {
    if (connectionTimer) clearTimeout(connectionTimer);
    connectionTimer = undefined;
  }

  async function handleMessage(message) {
    if (message.type === "client.accepted") {
      reconnectAttempt = 0;
      setState("online");
      return;
    }
    if (message.type === "sync.required") {
      setState("syncing");
      const syncedTo = await options.onSyncRequired({
        latestEventId: message.latestEventId,
        reason: message.reason
      });
      options.setLastEventId(Number.isInteger(syncedTo) ? syncedTo : message.latestEventId);
      setState("online");
      return;
    }
    if (message.type !== "event" || !message.event) {
      return;
    }

    const event = message.event;
    let cursor = options.getLastEventId();
    if (Number.isInteger(cursor) && event.eventId <= cursor) {
      return;
    }
    if (Number.isInteger(cursor) && cursor >= 0 && event.eventId !== cursor + 1) {
      setState("syncing");
      const syncedTo = await options.onSyncRequired({
        latestEventId: event.eventId,
        reason: "event_gap"
      });
      cursor = Number.isInteger(syncedTo) ? syncedTo : event.eventId;
      options.setLastEventId(cursor);
      setState("online");
      if (event.eventId <= cursor) {
        return;
      }
    }

    await options.onEvent(event);
    options.setLastEventId(event.eventId);
    if (socket?.readyState === WebSocketImpl.OPEN) {
      socket.send(JSON.stringify({ type: "client.ack", eventId: event.eventId }));
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer || stopped) return;
    const baseDelay = reconnectDelays[Math.min(reconnectAttempt, reconnectDelays.length - 1)];
    const delay = baseDelay + Math.floor(baseDelay * 0.2 * random());
    reconnectAttempt += 1;
    setState("reconnecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  }

  function setState(state) {
    options.onState?.(state);
  }

  return { start, stop, restart, whenIdle };
}

function toWebSocketUrl(apiBase) {
  return apiBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:") + "/events";
}
