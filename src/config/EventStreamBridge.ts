// EventStreamBridge — fans EventBus events out to SSE clients on /events.
// Subscribers are added per HTTP request. Each subscriber receives a copy of
// every event until it unsubscribes (e.g. on connection close).
//
// Authentication: if AGENTIX_SESSION_TOKEN/sessionToken is configured,
// ?token=<session-token> or Bearer <token> must match it.

import type { FastifyInstance } from "fastify";
import { EventBus, type AgentixEventName, type AgentixEventMap } from "./EventBus.js";
import { loadConfig } from "./index.js";
import { extractSessionToken, isSessionTokenAuthorized } from "./HttpAuth.js";

type Subscriber = {
  id: number;
  write: (chunk: string) => void;
};

const subscribers = new Set<Subscriber>();
let nextId = 1;
let unsubscribers: Array<() => void> = [];

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

export function isEventStreamAuthorized(
  configuredToken: string | null,
  providedToken: string | null,
): boolean {
  return isSessionTokenAuthorized(configuredToken, providedToken);
}

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
    "gateway:message",
    "gateway:enabled",
    "gateway:disabled",
    "powerhouse:starting",
    "powerhouse:started",
    "powerhouse:stopping",
    "powerhouse:stopped",
  ];
  for (const name of names) {
    unsubscribers.push(EventBus.on(name, (payload) => broadcast(name, payload)));
  }
}

export function stopEventStreamBridge(): void {
  for (const unsubscribe of unsubscribers) {
    unsubscribe();
  }
  unsubscribers = [];

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
    const token = extractSessionToken(request);

    if (!isEventStreamAuthorized(cfg.sessionToken, token)) {
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
