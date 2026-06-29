// SessionCoordinator — manages active sessions and persists them to disk.
// On startup, Powerhouse calls `recover()` to load any `active` sessions
// from <dataDir>/sessions/*.json so they can be resumed.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../config/paths.js";
import type { Session } from "./types.js";

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
        const raw = readFileSync(join(this.dir, file), "utf-8");
        const session = JSON.parse(raw) as Session;
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
    try {
      writeFileSync(path, JSON.stringify(session, null, 2), "utf-8");
    } catch {
      // Disk full / permission denied — log to stderr; Powerhouse can still
      // run in memory.
      console.error(`SessionCoordinator: failed to persist ${session.id}`);
    }
  }
}
