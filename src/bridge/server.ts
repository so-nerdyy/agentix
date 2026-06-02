import Fastify from "fastify";
import cors from "@fastify/cors";
import { getBackendRuntime } from "../runtime/backend.js";

const PORT = parseInt(process.env.AGENTIX_BRIDGE_PORT || "3456", 10);
const HOST = "127.0.0.1";

export async function startBridge() {
  const runtime = getBackendRuntime();

  const server = Fastify({ logger: false });

  await server.register(cors, {
    origin: false,
    methods: ["GET", "POST", "OPTIONS"],
  });

  server.get("/health", async () => ({ status: "ok", backend: "agentix" }));

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
  server.post("/sessions", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    return runtime.createSession({ model: body.model as string | undefined });
  });
  server.delete("/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return runtime.deleteSession(id);
  });

  server.get("/memory/search", async (request, reply) => {
    const q = (request.query as Record<string, string>).q || "";
    return runtime.memorySearch(q);
  });
  server.post("/memory/consolidate", async (request) => {
    const body = request.body as Record<string, unknown> | undefined;
    return runtime.consolidateMemory(body?.sessionId as string | undefined);
  });

  server.get("/tools", async () => runtime.listTools());
  server.get("/tasks", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return runtime.listTasks(query.sessionId);
  });
  server.get("/approvals", async () => runtime.listApprovals());
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
  server.get("/healing/stats", async () => runtime.healingStats());
  server.post("/healing/procedures/:id/promote", async (request) => {
    const { id } = request.params as { id: string };
    return runtime.promoteHealingProcedure(id);
  });
  server.post("/healing/procedures/:id/deprecate", async (request) => {
    const { id } = request.params as { id: string };
    return runtime.deprecateHealingProcedure(id);
  });
  server.get("/scheduler/jobs", async () => runtime.listJobs());
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

  await server.listen({ port: PORT, host: HOST });
  console.error(`Bridge listening on ${HOST}:${PORT}`);
  return {
    close: async () => {
      runtime.shutdown();
      await server.close();
    },
  };
}
