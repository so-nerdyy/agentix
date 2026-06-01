import Fastify from "fastify";
import cors from "@fastify/cors";
import { LocalAgentixRuntime } from "../runtime/LocalAgentixRuntime.js";

const PORT = parseInt(process.env.AGENTIX_BRIDGE_PORT || "3456", 10);
const HOST = "127.0.0.1";

export async function startBridge() {
  const runtime = new LocalAgentixRuntime();

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

  server.get("/tools", async () => runtime.listTools());

  await server.listen({ port: PORT, host: HOST });
  console.error(`Bridge listening on ${HOST}:${PORT}`);
}
