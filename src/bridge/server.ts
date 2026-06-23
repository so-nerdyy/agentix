import Fastify from "fastify";
import cors from "@fastify/cors";
import { getBackendRuntime } from "../runtime/backend.js";
import { assertSafeListenHost, requireSessionToken, requiredRoleForRequest } from "../config/HttpAuth.js";
import { loadConfig } from "../config/index.js";
import { openApiSpec } from "../config/openapi.js";

export async function startBridge(opts: { port?: number; host?: string } = {}) {
  const runtime = getBackendRuntime();
  const port = opts.port ?? parseInt(process.env.AGENTIX_BRIDGE_PORT || "3456", 10);
  const host = opts.host ?? "127.0.0.1";
  assertSafeListenHost(host, loadConfig().sessionToken);

  const server = Fastify({ logger: false });

  await server.register(cors, {
    origin: false,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  server.addHook("preHandler", async (request, reply) => {
    const pathname = request.url.split("?")[0];
    if (request.method === "OPTIONS" || pathname === "/health" || pathname === "/openapi.json") return;
    if (!requireSessionToken(request, reply, loadConfig().sessionToken, requiredRoleForRequest(request.method, pathname))) return reply;
  });

  server.get("/health", async () => ({ status: "ok", backend: "agentix" }));
  server.get("/openapi.json", async () => openApiSpec);
  server.get("/doctor", async () => runtime.doctor());
  server.get("/usage", async () => runtime.usage());
  server.get("/config", async () => runtime.config());
  server.get("/auth/status", async () => runtime.authStatus());
  server.get("/auth/tokens", async () => runtime.listAuthTokens());
  server.post("/auth/tokens", async (request) => {
    const body = request.body as Record<string, unknown> | undefined;
    return runtime.createAuthToken({
      label: body?.label as string | undefined,
      role: body?.role as "viewer" | "operator" | "admin" | undefined,
    });
  });
  server.delete("/auth/tokens/:id", async (request) => {
    const { id } = request.params as { id: string };
    return runtime.revokeAuthToken(id);
  });
  server.post("/config", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    if (!body?.key) {
      reply.status(400);
      return { ok: false, error: "missing config key" };
    }
    const result = runtime.setConfigValue(String(body.key), body.value);
    if (result.ok === false) reply.status(400);
    return result;
  });

  server.post("/execute/stream", async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    reply.raw!.setHeader("Content-Type", "text/event-stream");
    reply.raw!.setHeader("Cache-Control", "no-cache");
    reply.raw!.setHeader("Connection", "keep-alive");
    reply.raw!.setHeader("X-Accel-Buffering", "no");

    try {
      await runtime.execute({
        stimulus: body.stimulus as string,
        sessionId: body.sessionId as string | undefined,
        onDelta: (delta: string) => {
          reply.raw!.write(`data: ${delta.replace(/\n/g, "\\n")}\n\n`);
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.raw!.write(
        `data: ${JSON.stringify({ error: msg }).replace(/\n/g, "\\n")}\n\n`,
      );
    }

    reply.raw!.write("data: [DONE]\n\n");
    reply.raw!.end();
    return reply;
  });

  server.post("/execute", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    return runtime.execute({
      stimulus: body.stimulus as string,
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
  server.post("/sessions", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    return runtime.createSession({ model: body.model as string | undefined });
  });
  server.delete("/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return runtime.deleteSession(id);
  });
  server.post("/sessions/:id/rename", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    return runtime.renameSession(id, String(body.title ?? ""));
  });
  server.post("/sessions/prune", async (request) => {
    const body = request.body as Record<string, unknown>;
    return runtime.pruneSessions({
      olderThanDays: body.olderThanDays === undefined ? undefined : Number(body.olderThanDays),
      source: body.source === undefined ? undefined : String(body.source),
    });
  });
  server.post("/sessions/optimize", async () => runtime.optimizeSessions());

  server.get("/memory/search", async (request, reply) => {
    const q = (request.query as Record<string, string>).q || "";
    return runtime.memorySearch(q);
  });
  server.get("/memory", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return runtime.listMemory(query.sessionId);
  });
  server.post("/memory/consolidate", async (request) => {
    const body = request.body as Record<string, unknown> | undefined;
    return runtime.consolidateMemory(body?.sessionId as string | undefined);
  });
  server.post("/memory/reset", async (request) => {
    const body = request.body as Record<string, unknown> | undefined;
    return runtime.resetMemory({
      target: body?.target as "all" | "memory" | "user" | undefined,
      sessionId: body?.sessionId as string | undefined,
    });
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
  server.get("/logs", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const limit = query.limit === undefined ? 100 : Number(query.limit);
    return runtime.listLogs(Number.isFinite(limit) && limit > 0 ? limit : 100);
  });
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
  server.get("/plans", async () => runtime.listPlans());
  server.get("/plans/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const plan = runtime.getPlan(id);
    if (!plan) {
      reply.status(404);
      return { error: `unknown plan: ${id}` };
    }
    return plan;
  });
  server.post("/plans/:id/action", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { action?: string } | undefined;
    if (!body?.action) {
      reply.status(400);
      return { ok: false, error: "missing plan action" };
    }
    const result = await runtime.controlPlan(id, body.action as "replay" | "cancel" | "retry-failed");
    if (result.ok === false) reply.status(400);
    return result;
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
      schedule: body.schedule === undefined ? undefined : String(body.schedule),
      intervalMs: body.intervalMs === undefined ? undefined : Number(body.intervalMs),
      script: body.script === undefined ? undefined : String(body.script),
      noAgent: body.noAgent === undefined ? undefined : Boolean(body.noAgent),
      workdir: body.workdir === undefined ? undefined : String(body.workdir),
      skills: Array.isArray(body.skills) ? body.skills.map(String) : undefined,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    });
  });
  server.post("/scheduler/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const result = runtime.updateJob(id, {
      name: body.name === undefined ? undefined : String(body.name),
      stimulus: body.stimulus === undefined ? undefined : String(body.stimulus),
      schedule: body.schedule === undefined ? undefined : String(body.schedule),
      intervalMs: body.intervalMs === undefined ? undefined : Number(body.intervalMs),
      script: body.script === undefined ? undefined : String(body.script),
      noAgent: body.noAgent === undefined ? undefined : Boolean(body.noAgent),
      workdir: body.workdir === undefined ? undefined : String(body.workdir),
      skills: Array.isArray(body.skills) ? body.skills.map(String) : undefined,
      enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
    });
    if (!result.ok) {
      reply.status(404);
      return { error: `unknown scheduled job: ${id}` };
    }
    return result;
  });
  server.put("/scheduler/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const result = runtime.updateJob(id, {
      name: body.name === undefined ? undefined : String(body.name),
      stimulus: body.stimulus === undefined ? undefined : String(body.stimulus),
      schedule: body.schedule === undefined ? undefined : String(body.schedule),
      intervalMs: body.intervalMs === undefined ? undefined : Number(body.intervalMs),
      script: body.script === undefined ? undefined : String(body.script),
      noAgent: body.noAgent === undefined ? undefined : Boolean(body.noAgent),
      workdir: body.workdir === undefined ? undefined : String(body.workdir),
      skills: Array.isArray(body.skills) ? body.skills.map(String) : undefined,
      enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
    });
    if (!result.ok) {
      reply.status(404);
      return { error: `unknown scheduled job: ${id}` };
    }
    return result;
  });
  server.post("/scheduler/jobs/:id/run", async (request) => {
    const { id } = request.params as { id: string };
    return runtime.runJob(id);
  });
  server.post("/scheduler/run-due", async () => runtime.runDueJobs());
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

  await server.listen({ port, host });
  const address = server.server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.error(`Bridge listening on ${host}:${actualPort}`);
  return {
    close: async () => {
      runtime.shutdown();
      await server.close();
    },
    port: actualPort,
  };
}
