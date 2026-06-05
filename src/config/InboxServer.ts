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
import { getBackendRuntime } from "../runtime/backend.js";

const VERSION = "2.1.0";

export async function startInboxServer(opts: { port?: number; host?: string } = {}): Promise<{
  close: () => Promise<void>;
  port: number;
}> {
  ensureDataDirs();
  startEventStreamBridge();

  const cfg = loadConfig();
  const port = opts.port ?? cfg.inboxPort;
  const host = opts.host ?? "127.0.0.1";

  const server = Fastify({ logger: false });
  const runtime = getBackendRuntime();

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

  server.post("/execute", async (request) => {
    const body = request.body as Record<string, unknown>;
    return runtime.execute({
      stimulus: String(body.stimulus ?? body.text ?? ""),
      sessionId: body.sessionId as string | undefined,
    });
  });
  server.get("/sessions", async () => runtime.listSessions());
  server.get("/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = runtime.getSession(id);
    if (!session) {
      reply.status(404);
      return { error: `unknown session: ${id}` };
    }
    return session;
  });
  server.post("/sessions", async (request) => {
    const body = request.body as Record<string, unknown>;
    return runtime.createSession({ model: body.model as string | undefined });
  });
  server.delete("/sessions/:id", async (request) => {
    const { id } = request.params as { id: string };
    runtime.deleteSession(id);
    return { ok: true };
  });
  server.get("/tasks", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return runtime.listTasks(query.sessionId);
  });
  server.get("/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = runtime.getTask(id);
    if (!task) {
      reply.status(404);
      return { error: `unknown task: ${id}` };
    }
    return task;
  });
  server.post("/tasks/:id/action", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { action?: string };
    if (!body?.action) {
      reply.status(400);
      return { error: "missing task action" };
    }
    return runtime.controlTask(id, body.action as never);
  });
  server.get("/tools", async () => runtime.listTools());
  server.get("/tools/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tool = runtime.getTool(id);
    if (!tool) {
      reply.status(404);
      return { error: `unknown tool: ${id}` };
    }
    return tool;
  });
  server.get("/logs", async () => runtime.listLogs());
  server.get("/logs/:index", async (request, reply) => {
    const index = Number((request.params as { index: string }).index);
    const detail = runtime.getLog(index);
    if (!detail) {
      reply.status(404);
      return { error: `unknown log entry: ${index}` };
    }
    return detail;
  });
  server.get("/search", async (request) => {
    const q = (request.query as Record<string, string>).q || "";
    return runtime.search(q);
  });
  server.get("/gateway", async () => runtime.listGateways());
  server.get("/gateway/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = runtime.getGateway(id);
    if (!detail) {
      reply.status(404);
      return { error: `unknown gateway: ${id}` };
    }
    return detail;
  });
  server.post("/gateway/:id/enable", async (request) => {
    const { id } = request.params as { id: string };
    return runtime.setGatewayEnabled(id, true);
  });
  server.post("/gateway/:id/disable", async (request) => {
    const { id } = request.params as { id: string };
    return runtime.setGatewayEnabled(id, false);
  });
  server.post("/gateway/:id/message", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown> | undefined;
    return runtime.receiveGatewayMessage({
      gatewayId: id,
      stimulus: String(body?.stimulus ?? body?.text ?? ""),
      sessionId: body?.sessionId as string | undefined,
      metadata: (body?.metadata as Record<string, unknown> | undefined) ?? undefined,
    });
  });
  server.get("/approvals", async () => runtime.listApprovals());
  server.get("/approvals/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const approval = runtime.getApproval(id);
    if (!approval) {
      reply.status(404);
      return { error: `unknown approval: ${id}` };
    }
    return approval;
  });
  server.post("/approvals/:id/approve", async (request) => {
    const { id } = request.params as { id: string };
    return runtime.approve(id);
  });
  server.post("/approvals/:id/reject", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown> | undefined;
    return runtime.reject(id, body?.reason as string | undefined);
  });
  server.get("/memory/search", async (request) => {
    const q = (request.query as Record<string, string>).q || "";
    return runtime.memorySearch(q);
  });
  server.post("/memory/consolidate", async (request) => {
    const body = request.body as Record<string, unknown> | undefined;
    return runtime.consolidateMemory(body?.sessionId as string | undefined);
  });
  server.get("/audit", async () => runtime.listAudit());
  server.get("/audit/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = runtime.getAudit(id);
    if (!detail) {
      reply.status(404);
      return { error: `unknown audit entry: ${id}` };
    }
    return detail;
  });
  server.post("/support/bundle", async () => runtime.createSupportBundle());
  server.get("/healing/stats", async () => runtime.healingStats());
  server.get("/healing/detail/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = runtime.getHealingDetail(id);
    if (!detail) {
      reply.status(404);
      return { error: `unknown healing entry: ${id}` };
    }
    return detail;
  });
  server.post("/healing/procedures/:id/promote", async (request) => {
    const { id } = request.params as { id: string };
    return runtime.promoteHealingProcedure(id);
  });
  server.post("/healing/procedures/:id/deprecate", async (request) => {
    const { id } = request.params as { id: string };
    return runtime.deprecateHealingProcedure(id);
  });
  server.get("/scheduler/jobs", async () => runtime.listJobs());
  server.get("/scheduler/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = runtime.getJob(id);
    if (!job) {
      reply.status(404);
      return { error: `unknown scheduled job: ${id}` };
    }
    return job;
  });
  server.post("/scheduler/jobs", async (request) => {
    const body = request.body as Record<string, unknown>;
    return runtime.createJob({
      name: String(body.name ?? "scheduled task"),
      stimulus: String(body.stimulus ?? ""),
      intervalMs: Number(body.intervalMs ?? 60_000),
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    });
  });
  server.post("/scheduler/jobs/:id/run", async (request) => {
    const { id } = request.params as { id: string };
    return runtime.runJob(id);
  });
  server.post("/scheduler/jobs/:id/enable", async (request) => {
    const { id } = request.params as { id: string };
    return runtime.setJobEnabled(id, true);
  });
  server.post("/scheduler/jobs/:id/disable", async (request) => {
    const { id } = request.params as { id: string };
    return runtime.setJobEnabled(id, false);
  });
  server.delete("/scheduler/jobs/:id", async (request) => {
    const { id } = request.params as { id: string };
    return runtime.removeJob(id);
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
