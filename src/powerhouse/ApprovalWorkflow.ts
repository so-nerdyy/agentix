// ApprovalWorkflow — gates tasks that require human approval (shell, code edits).
// Tasks enter via `request(task)` and are parked in `awaiting-approval` until
// someone calls `approve(taskId)` or `reject(taskId, reason?)`, or until
// `approvalTimeoutMs` elapses (default 5 min → auto-reject).
//
// Emits `task:approve` and `task:reject` on the EventBus. Powerhouse listens
// for those to drive the next step in the task state machine.

import { EventBus } from "../config/EventBus.js";
import { loadConfig } from "../config/index.js";
import type { Task } from "./types.js";

export class ApprovalWorkflow {
  private readonly pending = new Map<string, Task>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly timeoutMs: number;

  constructor(opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? loadConfig().approvalTimeoutMs;
  }

  /**
   * Park a task in `awaiting-approval` and start the timeout.
   * Emits `task:approve` (notifying listeners a decision is needed).
   */
  request(task: Task): void {
    this.pending.set(task.id, task);
    EventBus.emit("task:approve", { taskId: task.id, sessionId: task.sessionId });

    const t = setTimeout(() => {
      this.pending.delete(task.id);
      this.timers.delete(task.id);
      EventBus.emit("task:reject", {
        taskId: task.id,
        sessionId: task.sessionId,
        reason: `Auto-rejected: approval timeout after ${this.timeoutMs}ms`,
      });
    }, this.timeoutMs);
    // Don't keep the event loop alive just for the approval timer.
    t.unref?.();
    this.timers.set(task.id, t);
  }

  approve(taskId: string): boolean {
    if (!this.pending.has(taskId)) return false;
    this.clearTimer(taskId);
    this.pending.delete(taskId);
    EventBus.emit("task:approve", { taskId, sessionId: "" });
    return true;
  }

  reject(taskId: string, reason?: string): boolean {
    if (!this.pending.has(taskId)) return false;
    this.clearTimer(taskId);
    this.pending.delete(taskId);
    EventBus.emit("task:reject", { taskId, sessionId: "", reason });
    return true;
  }

  isPending(taskId: string): boolean {
    return this.pending.has(taskId);
  }

  listPending(): Task[] {
    return Array.from(this.pending.values());
  }

  /**
   * Cancel all pending approvals and clear timers. Used during
   * Powerhouse.stop() so the process can exit cleanly.
   */
  shutdown(): void {
    for (const id of this.pending.keys()) {
      this.clearTimer(id);
    }
    this.pending.clear();
  }

  private clearTimer(taskId: string): void {
    const t = this.timers.get(taskId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(taskId);
    }
  }
}
