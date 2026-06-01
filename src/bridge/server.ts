// HTTP bridge server - listens on 127.0.0.1:3456 and proxies
// execute/stream requests to the Python AgentixBackend, returning SSE stream.

import Fastify from "fastify";
import cors from "@fastify/cors";
import { AgentixBackend as HttpBridgeClient } from "../agentix_backend.js";

const PORT = parseInt(process.env.AGENTIX_BRIDGE_PORT || "3456", 10);
const HOST = "127.0.0.1";

export async function startBridge() {
  const backend = new HttpBridgeClient();

  const server = Fastify({ logger: false });

  await server.register(cors, {
    origin: false,
    methods: ["GET", "POST", "OPTIONS"],
  });

  // Health check endpoint
  server.get("/health", async () => ({ status: "ok", backend: "hermes" }));

  // Streaming execute endpoint - SSE
  server.post("/execute/stream", async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    reply.raw!.setHeader("Content-Type", "text/event-stream");
    reply.raw!.setHeader("Cache-Control", "no-cache");
    reply.raw!.setHeader("Connection", "keep-alive");
    reply.raw!.setHeader("X-Accel-Buffering", "no");

    let streamEnded = false;

    try {
      await backend.executeStream({
        stimulus: body.stimulus as string,
        sessionId: body.sessionId as string | undefined,
        streamCallback: (delta: string) => {
          if (streamEnded) return;
          reply.raw!.write(`data: ${delta.replace(/\n/g, "\\n")}\n\n`);
        },
      });
    } catch (err: unknown) {
      if (!streamEnded) {
        const msg = err instanceof Error ? err.message : String(err);
        reply.raw!.write(`data: ${JSON.stringify({ error: msg }).replace(/\n/g, "\\n")}\n\n`);
      }
    }

    if (!streamEnded) {
      reply.raw!.write("data: [DONE]\n\n");
    }
    reply.raw!.end();
    return reply;
  });

  // Non-streaming execute
  server.post("/execute", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    return backend.execute({
      stimulus: body.stimulus as string,
      sessionId: body.sessionId as string | undefined,
    });
  });

  // Session management
  server.get("/sessions", async () => backend.listSessions());
  server.post("/sessions", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    return backend.createSession({ model: body.model as string | undefined });
  });
  server.delete("/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return backend.deleteSession(id);
  });

  // Memory search
  server.get("/memory/search", async (request, reply) => {
    const q = (request.query as Record<string, string>).q || "";
    return backend.memorySearch(q);
  });

  // Tools list
  server.get("/tools", async () => backend.listTools());

  await server.listen({ port: PORT, host: HOST });
  console.error(`Bridge listening on ${HOST}:${PORT}`);
}