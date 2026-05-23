import http from "node:http";
import { createApp } from "./app.js";
import { attachAgentWebSocketServer } from "./agentWs.js";
import { loadDispatcherConfig } from "../shared/config.js";
import { TaskStore } from "./taskStore.js";
import { notifyTaskFinished } from "./notifier.js";
import type { TaskRecord } from "../shared/types.js";

const config = loadDispatcherConfig();
const store = new TaskStore(process.env.OPENCLAW_DATA_FILE ?? "data/openclaw-state.json");
const app = createApp(config, store);
const server = http.createServer(app);

attachAgentWebSocketServer({ server, config, store });

store.onStoreEvent("task.updated", (record) => {
  const task = record as TaskRecord;
  void notifyTaskFinished(config, task);
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`OpenClaw Codex dispatcher listening on ${config.server.publicBaseUrl}`);
});
