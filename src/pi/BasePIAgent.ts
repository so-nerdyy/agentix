// BasePIAgent — abstract class for all PI (Process Initiative) agents.
// Concrete agents (SandboxAgent, BashAgent, CodeAgent) extend this and
// implement `execute`. Output and lifecycle events are reported through
// the EventBus by the agent itself.

import { EventBus } from "../config/EventBus.js";
import { randomUUID } from "node:crypto";
import type { Task, TaskResult } from "../powerhouse/types.js";

export abstract class BasePIAgent {
  readonly id: string;
  readonly kind: string;
  protected alive = true;

  constructor(kind: string, id?: string) {
    this.kind = kind;
    this.id = id ?? `${kind}-${randomUUID().slice(0, 6)}`;
  }

  healthy(): boolean {
    return this.alive;
  }

  /**
   * Run a task and return the result. Subclasses implement this.
   * Throw on unrecoverable error.
   */
  abstract execute(task: Task): Promise<TaskResult>;

  /**
   * Optional hook for cleanup. Called by PIAgentRegistry.shutdown().
   */
  shutdown?(): void;

  protected emitStart(task: Task): void {
    EventBus.emit("agent:start", {
      agentId: this.id,
      agentKind: this.kind,
      sessionId: task.sessionId,
    });
  }

  protected emitComplete(task: Task, result: TaskResult): void {
    EventBus.emit("agent:complete", {
      agentId: this.id,
      agentKind: this.kind,
      sessionId: task.sessionId,
      result,
    });
  }

  protected emitError(task: Task, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    EventBus.emit("agent:error", {
      agentId: this.id,
      sessionId: task.sessionId,
      error: message,
    });
  }
}
