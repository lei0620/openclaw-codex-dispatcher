import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DispatcherConfig } from "../shared/types.js";
import { createApiRouter } from "./api.js";
import type { TaskStore } from "./taskStore.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(config: DispatcherConfig, store: TaskStore): express.Express {
  const app = express();
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.resolve(dirname, "../../public")));
  app.use("/api", createApiRouter({ config, store }));
  return app;
}
