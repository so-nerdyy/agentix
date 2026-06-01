import { describe, expect, it } from "vitest";
import { TaskQueue } from "../../src/powerhouse/TaskQueue.js";
import type { Task } from "../../src/powerhouse/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    sessionId: "sess-1",
    kind: "bash",
    priority: "user",
    status: "queued",
    payload: {},
    createdAt: Date.now(),
    attempts: 0,
    maxAttempts: 3,
    requiresApproval: false,
    ...overrides,
  };
}

describe("TaskQueue", () => {
  it("prefers user tasks and records lifecycle transitions", () => {
    const queue = new TaskQueue();
    const background = makeTask({
      id: "task-bg",
      kind: "sandbox-run",
      priority: "background",
    });
    const user = makeTask({ id: "task-user" });

    queue.enqueue(background);
    queue.enqueue(user);

    expect(queue.size()).toBe(2);
    expect(queue.nextForSession("sess-1")?.id).toBe("task-user");

    const dequeued = queue.dequeue("sess-1");
    expect(dequeued?.id).toBe("task-user");
    expect(dequeued?.status).toBe("running");
    expect(dequeued?.startedAt).toBeTypeOf("number");

    if (!dequeued) throw new Error("expected dequeued task");
    queue.transition(dequeued, "complete");
    expect(dequeued.status).toBe("complete");
    expect(dequeued.finishedAt).toBeTypeOf("number");
  });

  it("rejects illegal status transitions", () => {
    const queue = new TaskQueue();
    const task = makeTask();

    expect(() => queue.transition(task, "complete")).toThrow(/Illegal transition/);
  });
});
