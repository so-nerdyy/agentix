// TaskQueue — in-memory priority queue of pending tasks per session.
// Backed by a per-session list. State machine:
//   queued → running → (awaiting-approval → running) → complete | rejected | failed
//
// Higher-priority tasks (user) are dequeued first. Within the same priority
// class, FIFO ordering is preserved.

import type { Task, TaskPriority, TaskStatus } from "./types.js";

const STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  queued: ["running", "rejected"],
  running: ["awaiting-approval", "complete", "failed"],
  "awaiting-approval": ["running", "rejected", "failed"],
  complete: [],
  rejected: [],
  failed: [],
};

export class TaskQueue {
  private readonly byId = new Map<string, Task>();
  // Per-session FIFO queues, separate for each priority.
  private readonly pendingUser = new Map<string, string[]>();
  private readonly pendingBg = new Map<string, string[]>();

  size(): number {
    return this.byId.size;
  }

  get(taskId: string): Task | undefined {
    return this.byId.get(taskId);
  }

  list(sessionId?: string): Task[] {
    const all = Array.from(this.byId.values());
    return sessionId ? all.filter((t) => t.sessionId === sessionId) : all;
  }

  enqueue(task: Task): void {
    if (this.byId.has(task.id)) {
      throw new Error(`Task ${task.id} already exists`);
    }
    this.byId.set(task.id, task);
    const bucket = this.bucket(task.priority, task.sessionId);
    bucket.push(task.id);
  }

  hydrate(tasks: Task[]): void {
    for (const task of tasks) {
      this.byId.set(task.id, task);
      if (task.status === "queued") {
        const bucket = this.bucket(task.priority, task.sessionId);
        if (!bucket.includes(task.id)) bucket.push(task.id);
      }
    }
  }

  upsert(task: Task): void {
    this.byId.set(task.id, task);
  }

  nextForSession(sessionId: string): Task | undefined {
    const user = this.pendingUser.get(sessionId);
    const bg = this.pendingBg.get(sessionId);
    const nextId = (user && user[0]) || (bg && bg[0]);
    if (!nextId) return undefined;
    return this.byId.get(nextId);
  }

  /**
   * Pull the next task off a session's queue. User-priority tasks come first.
   * Marks the task as `running` and records startedAt.
   */
  dequeue(sessionId: string): Task | undefined {
    const userBucket = this.pendingUser.get(sessionId);
    const bgBucket = this.pendingBg.get(sessionId);

    let id: string | undefined;
    if (userBucket && userBucket.length > 0) {
      id = userBucket.shift();
    } else if (bgBucket && bgBucket.length > 0) {
      id = bgBucket.shift();
    }
    if (!id) return undefined;
    const task = this.byId.get(id);
    if (!task) return undefined;
    this.transition(task, "running");
    task.startedAt = Date.now();
    return task;
  }

  dequeueTask(taskId: string): Task | undefined {
    const task = this.byId.get(taskId);
    if (!task || task.status !== "queued") return undefined;
    for (const bucket of [this.pendingUser, this.pendingBg]) {
      const arr = bucket.get(task.sessionId);
      const index = arr?.indexOf(taskId) ?? -1;
      if (arr && index >= 0) {
        arr.splice(index, 1);
      }
    }
    this.transition(task, "running");
    task.startedAt = Date.now();
    return task;
  }

  requeue(task: Task): void {
    if (!this.byId.has(task.id)) {
      this.byId.set(task.id, task);
    }
    const bucket = this.bucket(task.priority, task.sessionId);
    if (!bucket.includes(task.id)) bucket.push(task.id);
  }

  transition(task: Task, next: TaskStatus): void {
    const allowed = STATUS_TRANSITIONS[task.status];
    if (!allowed.includes(next)) {
      throw new Error(
        `Illegal transition for task ${task.id}: ${task.status} → ${next}`,
      );
    }
    task.status = next;
    if (next === "complete" || next === "rejected" || next === "failed") {
      task.finishedAt = Date.now();
    }
  }

  remove(taskId: string): void {
    const t = this.byId.get(taskId);
    if (!t) return;
    this.byId.delete(taskId);
    for (const bucket of [this.pendingUser, this.pendingBg]) {
      const arr = bucket.get(t.sessionId);
      if (arr) {
        const i = arr.indexOf(taskId);
        if (i >= 0) arr.splice(i, 1);
      }
    }
  }

  cancel(taskId: string): Task | undefined {
    const task = this.byId.get(taskId);
    if (!task) return undefined;
    if (!["queued", "running", "awaiting-approval"].includes(task.status)) {
      return undefined;
    }
    this.remove(taskId);
    task.status = "rejected";
    task.finishedAt = Date.now();
    task.error = task.error ?? "cancelled";
    return task;
  }

  retry(taskId: string): Task | undefined {
    const task = this.byId.get(taskId);
    if (!task) return undefined;
    if (!["failed", "rejected"].includes(task.status)) return undefined;
    task.status = "queued";
    task.startedAt = undefined;
    task.finishedAt = undefined;
    task.error = undefined;
    this.requeue(task);
    return task;
  }

  pendingForSession(sessionId: string): number {
    const u = this.pendingUser.get(sessionId)?.length ?? 0;
    const b = this.pendingBg.get(sessionId)?.length ?? 0;
    return u + b;
  }

  private bucket(priority: TaskPriority, sessionId: string): string[] {
    const map = priority === "user" ? this.pendingUser : this.pendingBg;
    let arr = map.get(sessionId);
    if (!arr) {
      arr = [];
      map.set(sessionId, arr);
    }
    return arr;
  }
}
