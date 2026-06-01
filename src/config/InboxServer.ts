// InboxServer — HTTP server on port 3000 (separate from the bridge on 3456).
// Exposes:
//   GET /health
//   GET /events       (SSE; ?token=<sessionToken> required)
//   GET /ui/*         (static files from frontend/dist, if it exists)
//   GET /             (redirect to /ui)
//
// Gracefully shuts down on SIGINT/SIGTERM.

import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "./index.js";
import {
  registerEventStreamRoutes,
  startEventStreamBridge,
  stopEventStreamBridge,
  subscriberCount,
} from "./EventStreamBridge.js";
import { EventBus } from "./EventBus.js";
import { ensureDataDirs, PATHS } from "./paths.js";

const VERSION = "2.1.0";

export async function startInboxServer(): Promise<{
  close: () => Promise<void>;
  port: number;
}> {
  ensureDataDirs();
  startEventStreamBridge();

  const cfg = loadConfig();
  const port = cfg.inboxPort;
  const host = "127.0.0.1";

  const server = Fastify({ logger: false });

  await server.register(cors, {
    origin: false,
    methods: ["GET", "POST", "OPTIONS"],
  });

  const startedAt = Date.now();

  server.get("/health", async () => ({
    status: "ok",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    version: VERSION,
    sseClients: subscriberCount(),
  }));

  server.get("/healing/stats", async () => {
    // Phase 3 will fill this in. Return a placeholder so clients don't 404.
    return { ready: false };
  });

  registerEventStreamRoutes(server);

  // Static UI — only registered if frontend/dist exists.
  const uiDir = resolve(PATHS.projectRoot, "frontend", "dist");
  if (existsSync(uiDir)) {
    await server.register(staticPlugin, { root: uiDir, prefix: "/ui/" });
  } else {
    server.get("/ui", async (_req, reply) => {
      reply.code(404).send({
        error: "ui_not_built",
        message: "Run `npm run build` in frontend/ to enable the web UI.",
      });
    });
  }

  server.get("/", async (_req, reply) => {
    reply.redirect("/ui");
  });

  await server.listen({ port, host });

  console.error(`InboxServer listening on http://${host}:${port}`);

  const close = async (): Promise<void> => {
    stopEventStreamBridge();
    await server.close();
  };

  // Graceful shutdown on signals.
  const onSignal = async (sig: NodeJS.Signals) => {
    console.error(`InboxServer received ${sig}, shutting down...`);
    EventBus.emit("powerhouse:stopping", {});
    try {
      await close();
    } finally {
      EventBus.emit("powerhouse:stopped", {});
      process.exit(0);
    }
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  return { close, port };
}

// Allow `node dist/config/InboxServer.js` to start the server.
const isEntry =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /InboxServer\.js$/.test(process.argv[1]);
if (isEntry) {
  startInboxServer().catch((err) => {
    console.error("InboxServer failed to start:", err);
    process.exit(1);
  });
}
