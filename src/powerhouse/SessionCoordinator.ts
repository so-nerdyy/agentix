// SessionCoordinator — manages active sessions and persists them to disk.
// On startup, Powerhouse calls `recover()` to load any `active` sessions
// from <dataDir>/sessions/*.json so they can be resumed.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../config/paths.js";
import type { Session, SessionMessage } from "./types.js";

const MAX_SESSION_MESSAGES = 1000;
const MAX_MESSAGE_CHARS = 64 * 1024;
const MAX_SESSION_FILE_BYTES = 16 * 1024 * 1024;
const SAFE_SESSION_ID = /^sess-[a-z0-9]+$/;
const SESSION_STATUSES = new Set<Session["status"]>(["pending", "active", "complete", "failed"]);

function normalizeSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id : "";
  if (!SAFE_SESSION_ID.test(id)) return null;
  const status = SESSION_STATUSES.has(candidate.status as Session["status"])
    ? candidate.status as Session["status"]
    : "active";
  const messages: SessionMessage[] = Array.isArray(candidate.messages)
    ? candidate.messages
        .filter((message) => message && typeof message === "object" && !Array.isArray(message))
        .map((message) => message as Record<string, unknown>)
        .filter((message) =>
          ["system", "user", "assistant"].includes(String(message.role)) &&
          typeof message.content === "string",
        )
        .slice(-MAX_SESSION_MESSAGES)
        .map((message) => ({
          role: message.role as SessionMessage["role"],
          content: String(message.content).slice(0, MAX_MESSAGE_CHARS),
          ts: Number.isFinite(Number(message.ts)) ? Number(message.ts) : Date.now(),
        }))
    : [];
  return {
    id,
    status,
    createdAt: Number.isFinite(Number(candidate.createdAt)) ? Number(candidate.createdAt) : Date.now(),
    updatedAt: Number.isFinite(Number(candidate.updatedAt)) ? Number(candidate.updatedAt) : Date.now(),
    metadata: candidate.metadata && typeof candidate.metadata === "object" && !Array.isArray(candidate.metadata)
      ? candidate.metadata as Record<string, unknown>
      : {},
    pendingTaskIds: Array.isArray(candidate.pendingTaskIds)
      ? candidate.pendingTaskIds.filter((id): id is string => typeof id === "string")
      : [],
    messages,
  };
}

export class SessionCoordinator {
  private readonly byId = new Map<string, Session>();

  constructor(private readonly dir: string = PATHS.sessionsDir) {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  create(metadata: Record<string, unknown> = {}): Session {
    const now = Date.now();
    const session: Session = {
      id: `sess-${randomUUID().slice(0, 8)}`,
      status: "active",
      createdAt: now,
      updatedAt: now,
      metadata,
      pendingTaskIds: [],
      messages: [],
    };
    this.byId.set(session.id, session);
    this.persist(session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.byId.get(id);
  }

  list(): Session[] {
    return Array.from(this.byId.values());
  }

  listRecent(limit = 50): Session[] {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);

    const sessions: Session[] = [];
    for (const file of files) {
      try {
        const path = join(this.dir, file);
        if (statSync(path).size > MAX_SESSION_FILE_BYTES) continue;
        const session = normalizeSession(JSON.parse(readFileSync(path, "utf-8")));
        if (session) sessions.push(session);
      } catch {
        // Corrupt session file remains for support-bundle inspection.
      }
    }
    return sessions
      .sort((left, right) => (right.updatedAt || right.createdAt) - (left.updatedAt || left.createdAt))
      .slice(0, Math.max(1, limit));
  }

  listActive(): Session[] {
    return this.list().filter((session) => session.status === "active");
  }

  count(): number {
    if (!existsSync(this.dir)) return 0;
    try {
      return readdirSync(this.dir).filter((f) => f.endsWith(".json")).length;
    } catch {
      return this.byId.size;
    }
  }

  setStatus(id: string, status: Session["status"]): void {
    const s = this.byId.get(id);
    if (!s) return;
    s.status = status;
    s.updatedAt = Date.now();
    this.persist(s);
  }

  updateMetadata(id: string, metadata: Record<string, unknown>): Session | undefined {
    const s = this.byId.get(id);
    if (!s) return undefined;
    s.metadata = { ...s.metadata, ...metadata };
    s.updatedAt = Date.now();
    this.persist(s);
    return s;
  }

  addPendingTask(sessionId: string, taskId: string): void {
    const s = this.byId.get(sessionId);
    if (!s) return;
    if (!s.pendingTaskIds.includes(taskId)) s.pendingTaskIds.push(taskId);
    s.updatedAt = Date.now();
    this.persist(s);
  }

  appendMessage(sessionId: string, message: Omit<SessionMessage, "ts">): SessionMessage | undefined {
    const session = this.byId.get(sessionId);
    if (!session) return undefined;
    const entry: SessionMessage = {
      role: message.role,
      content: message.content.slice(0, MAX_MESSAGE_CHARS),
      ts: Date.now(),
    };
    session.messages.push(entry);
    if (session.messages.length > MAX_SESSION_MESSAGES) {
      session.messages.splice(0, session.messages.length - MAX_SESSION_MESSAGES);
    }
    session.updatedAt = entry.ts;
    this.persist(session);
    return { ...entry };
  }

  getMessages(sessionId: string): SessionMessage[] {
    return (this.byId.get(sessionId)?.messages ?? []).map((message) => ({ ...message }));
  }

  clearMessages(sessionId: string): void {
    const session = this.byId.get(sessionId);
    if (!session) return;
    session.messages = [];
    session.updatedAt = Date.now();
    this.persist(session);
  }

  replaceMessages(
    sessionId: string,
    messages: Array<Omit<SessionMessage, "ts"> & { ts?: number }>,
  ): SessionMessage[] | undefined {
    const session = this.byId.get(sessionId);
    if (!session) return undefined;
    const now = Date.now();
    session.messages = messages
      .filter((message) => ["system", "user", "assistant"].includes(message.role))
      .filter((message) => typeof message.content === "string" && message.content.trim())
      .slice(-MAX_SESSION_MESSAGES)
      .map((message, index) => ({
        role: message.role,
        content: message.content.slice(0, MAX_MESSAGE_CHARS),
        ts: Number.isFinite(message.ts) ? Number(message.ts) : now + index,
      }));
    session.updatedAt = Date.now();
    this.persist(session);
    return session.messages.map((message) => ({ ...message }));
  }

  undoLastTurn(sessionId: string): { removed: number; messages: SessionMessage[] } | undefined {
    const session = this.byId.get(sessionId);
    if (!session) return undefined;
    let removed = 0;
    while (session.messages.at(-1)?.role === "assistant") {
      session.messages.pop();
      removed += 1;
    }
    if (session.messages.at(-1)?.role === "user") {
      session.messages.pop();
      removed += 1;
    }
    if (removed > 0) {
      session.updatedAt = Date.now();
      this.persist(session);
    }
    return {
      removed,
      messages: session.messages.map((message) => ({ ...message })),
    };
  }

  removePendingTask(sessionId: string, taskId: string): void {
    const s = this.byId.get(sessionId);
    if (!s) return;
    s.pendingTaskIds = s.pendingTaskIds.filter((id) => id !== taskId);
    s.updatedAt = Date.now();
    this.persist(s);
  }

  close(id: string): void {
    const s = this.byId.get(id);
    if (!s) return;
    s.status = "complete";
    s.updatedAt = Date.now();
    this.persist(s);
  }

  delete(id: string): boolean {
    if (!SAFE_SESSION_ID.test(id)) return false;
    const path = join(this.dir, `${id}.json`);
    const existed = this.byId.delete(id) || existsSync(path);
    if (!existed) return false;
    rmSync(path, { force: true });
    return true;
  }

  /**
   * Load every active session from disk into memory. Called by
   * Powerhouse.start() during recovery.
   */
  recover(): Session[] {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    const recovered: Session[] = [];
    for (const file of files) {
      try {
        const path = join(this.dir, file);
        if (statSync(path).size > MAX_SESSION_FILE_BYTES) continue;
        const session = normalizeSession(JSON.parse(readFileSync(path, "utf-8")));
        if (!session) continue;
        this.byId.set(session.id, session);
        if (session.status === "active") {
          recovered.push(session);
        }
      } catch {
        // Corrupt session file — leave it alone, the user can clean up.
      }
    }
    return recovered;
  }

  private persist(session: Session): void {
    const path = join(this.dir, `${session.id}.json`);
    if (!SAFE_SESSION_ID.test(session.id)) {
      console.error(`SessionCoordinator: refused unsafe session id ${session.id}`);
      return;
    }
    const temporary = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(session, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
      renameSync(temporary, path);
    } catch {
      rmSync(temporary, { force: true });
      // Disk full / permission denied — log to stderr; Powerhouse can still
      // run in memory.
      console.error(`SessionCoordinator: failed to persist ${session.id}`);
    }
  }
}
