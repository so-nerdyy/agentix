// EventStreamBridge — fans EventBus events out to SSE clients on /events.
// Subscribers are added per HTTP request. Each subscriber receives a copy of
// every event until it unsubscribes (e.g. on connection close).
//
// Authentication: ?token=<session-token> must equal AGENTIX_SESSION_TOKEN
// (or the sessionToken in config.json).

import type { FastifyInstance } from "fastify";
import { EventBus, type AgentixEventName, type AgentixEventMap } from "./EventBus.js";
import { loadConfig } from "./index.js";

type Subscriber = {
  id: number;
  write: (chunk: string) => void;
};

const subscribers = new Set<Subscriber>();
let nextId = 1;

function broadcast(event: AgentixEventName, payload: AgentixEventMap[AgentixEventName]): void {
  if (subscribers.size === 0) return;
  const chunk =
    "event: " +
    event +
    "\ndata: " +
    JSON.stringify(payload).replace(/\n/g, "\\n") +
    "\n\n";
  for (const sub of subscribers) {
    try {
      sub.write(chunk);
    } catch {
      subscribers.delete(sub);
    }
  }
}

let started = false;

export function startEventStreamBridge(): void {
  if (started) return;
  started = true;

  // Re-broadcast every event onto all SSE subscribers.
  const names: AgentixEventName[] = [
    "agent:start",
    "agent:complete",
    "agent:error",
    "task:queued",
    "task:running",
    "task:approve",
    "task:reject",
    "task:complete",
    "task:failed",
    "session:create",
    "session:close",
    "powerhouse:starting",
    "powerhouse:started",
    "powerhouse:stopping",
    "powerhouse:stopped",
  ];
  for (const name of names) {
    EventBus.on(name, (payload) => broadcast(name, payload));
  }
}

export function stopEventStreamBridge(): void {
  // Remove all event listeners we registered on the bus. The unsubscribes
  // are attached to a marker we can find via listenerCount, but it's easier
  // to clear all listeners on the bus — Powerhouse.stop() calls this only
  // when it's about to tear down its own subscribers anyway.
  EventBus.removeAllListeners("agent:start");
  EventBus.removeAllListeners("agent:complete");
  EventBus.removeAllListeners("agent:error");
  EventBus.removeAllListeners("task:queued");
  EventBus.removeAllListeners("task:running");
  EventBus.removeAllListeners("task:approve");
  EventBus.removeAllListeners("task:reject");
  EventBus.removeAllListeners("task:complete");
  EventBus.removeAllListeners("task:failed");
  EventBus.removeAllListeners("session:create");
  EventBus.removeAllListeners("session:close");
  EventBus.removeAllListeners("powerhouse:starting");
  EventBus.removeAllListeners("powerhouse:started");
  EventBus.removeAllListeners("powerhouse:stopping");
  EventBus.removeAllListeners("powerhouse:stopped");

  // Tell every SSE client we're done so they can close cleanly.
  for (const sub of subscribers) {
    try {
      sub.write("event: bridge:closed\ndata: {}\n\n");
    } catch {
      /* ignore */
    }
  }
  subscribers.clear();
  started = false;
}

export function subscriberCount(): number {
  return subscribers.size;
}

export function registerEventStreamRoutes(server: FastifyInstance): void {
  server.get("/events", (request, reply) => {
    const cfg = loadConfig();
    const token =
      (request.query as Record<string, string>).token ??
      request.headers.authorization?.replace(/^Bearer\s+/i, "") ??
      null;

    if (!cfg.sessionToken || token !== cfg.sessionToken) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }

    reply.raw!.setHeader("Content-Type", "text/event-stream");
    reply.raw!.setHeader("Cache-Control", "no-cache");
    reply.raw!.setHeader("Connection", "keep-alive");
    reply.raw!.setHeader("X-Accel-Buffering", "no");
    reply.raw!.writeHead(200);

    const sub: Subscriber = {
      id: nextId++,
      write: (chunk) => reply.raw!.write(chunk),
    };
    subscribers.add(sub);

    // Greet the client so it knows the stream is live.
    reply.raw!.write(`event: bridge:hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    const heartbeat = setInterval(() => {
      try {
        reply.raw!.write(": ping\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    const close = () => {
      clearInterval(heartbeat);
      subscribers.delete(sub);
    };

    request.raw.on("close", close);
    request.raw.on("error", close);
  });
}
