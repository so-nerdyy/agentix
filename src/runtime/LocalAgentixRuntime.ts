import { randomUUID } from "node:crypto";
import { EventBus } from "../config/EventBus.js";
import { SessionCoordinator } from "../powerhouse/SessionCoordinator.js";
import { TaskQueue } from "../powerhouse/TaskQueue.js";
import type { Session, Task } from "../powerhouse/types.js";

type MemoryEntry = {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export class LocalAgentixRuntime {
  private readonly sessions = new SessionCoordinator();
  private readonly queue = new TaskQueue();
  private readonly memory: MemoryEntry[] = [];

  listSessions(): Array<{ id: string; createdAt: string }> {
    this.sessions.recover();
    return this.sessions.list().map((session) => ({
      id: session.id,
      createdAt: new Date(session.createdAt).toISOString(),
    }));
  }

  createSession(opts?: { model?: string }): { id: string } {
    const session = this.sessions.create({
      model: opts?.model ?? null,
      source: "agentix-runtime",
    });
    EventBus.emit("session:create", { sessionId: session.id });
    return { id: session.id };
  }

  deleteSession(id: string): void {
    this.sessions.setStatus(id, "complete");
    EventBus.emit("session:close", { sessionId: id });
  }

  memorySearch(query: string): Array<{ content: string; score: number }> {
    if (!query.trim()) {
      return [];
    }

    const needle = query.toLowerCase();
    return this.memory
      .filter((entry) => entry.content.toLowerCase().includes(needle))
      .slice(-10)
      .reverse()
      .map((entry) => ({
        content: `[${entry.role}] ${entry.content}`,
        score: 1,
      }));
  }

  listTools(): Array<{ name: string; description: string }> {
    return [
      {
        name: "powerhouse",
        description: "Coordinates sessions and task lifecycle in the Agentix backend.",
      },
      {
        name: "pi-bash",
        description: "Represents a future shell-command PI worker execution path.",
      },
      {
        name: "pi-code",
        description: "Represents a future code-edit PI worker execution path.",
      },
      {
        name: "pi-sandbox",
        description: "Represents a future sandboxed execution path.",
      },
    ];
  }

  async execute(
    opts: {
      stimulus: string;
      sessionId?: string;
      onDelta?: (delta: string) => void;
    },
  ): Promise<{ response: string; sessionId: string }> {
    const session = this.ensureSession(opts.sessionId);
    const task = this.createTask(session.id, opts.stimulus);

    this.queue.enqueue(task);
    this.sessions.addPendingTask(session.id, task.id);
    EventBus.emit("task:queued", {
      taskId: task.id,
      sessionId: session.id,
      kind: task.kind,
    });

    const running = this.queue.dequeue(session.id);
    if (!running) {
      throw new Error("failed to dequeue recovery task");
    }

    EventBus.emit("task:running", { taskId: running.id, sessionId: session.id });
    this.memory.push({
      sessionId: session.id,
      role: "user",
      content: opts.stimulus,
      createdAt: Date.now(),
    });

    const response = this.buildResponse(opts.stimulus, session.id, running.id);
    for (const chunk of this.streamChunks(response)) {
      opts.onDelta?.(chunk);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    running.result = response;
    this.queue.transition(running, "complete");
    this.sessions.removePendingTask(session.id, running.id);
    this.memory.push({
      sessionId: session.id,
      role: "assistant",
      content: response,
      createdAt: Date.now(),
    });

    EventBus.emit("task:complete", {
      taskId: running.id,
      sessionId: session.id,
      result: response,
    });

    return { response, sessionId: session.id };
  }

  private ensureSession(sessionId?: string): Session {
    this.sessions.recover();
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing) {
        return existing;
      }
    }

    const created = this.sessions.create({ source: "agentix-runtime" });
    EventBus.emit("session:create", { sessionId: created.id });
    return created;
  }

  private createTask(sessionId: string, stimulus: string): Task {
    return {
      id: `task-${randomUUID().slice(0, 8)}`,
      sessionId,
      kind: "user-message",
      priority: "user",
      status: "queued",
      payload: { stimulus },
      createdAt: Date.now(),
      attempts: 1,
      maxAttempts: 1,
      requiresApproval: false,
    };
  }

  private buildResponse(stimulus: string, sessionId: string, taskId: string): string {
    return [
      "Agentix backend restored to the Hermes-integration stage.",
      `Session: ${sessionId}`,
      `Task: ${taskId}`,
      "",
      "The Hermes frontend is real and wired into the Agentix bridge again.",
      "This recovery runtime owns task/session flow while the full Symphony and Pi execution layer is rebuilt.",
      "",
      `You said: ${stimulus}`,
    ].join("\n");
  }

  private streamChunks(text: string): string[] {
    const parts = text.split(/(\s+)/).filter((part) => part.length > 0);
    return parts.length > 0 ? parts : [text];
  }
}
