import { describe, expect, it, vi } from "vitest";
import { ApprovalWorkflow } from "../../src/powerhouse/ApprovalWorkflow.js";
import type { Task } from "../../src/powerhouse/types.js";

function makeTask(): Task {
  return {
    id: "task-approval",
    sessionId: "sess-approval",
    kind: "bash",
    priority: "user",
    status: "awaiting-approval",
    payload: {},
    createdAt: Date.now(),
    attempts: 0,
    maxAttempts: 1,
    requiresApproval: true,
  };
}

describe("ApprovalWorkflow", () => {
  it("auto-rejects when approval times out", () => {
    vi.useFakeTimers();
    try {
      const workflow = new ApprovalWorkflow({ timeoutMs: 100 });
      const task = makeTask();

      workflow.request(task);
      expect(workflow.isPending(task.id)).toBe(true);
      expect(workflow.listPending()).toHaveLength(1);

      vi.advanceTimersByTime(150);

      expect(workflow.isPending(task.id)).toBe(false);
      expect(workflow.listPending()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports explicit approval and rejection", () => {
    const workflow = new ApprovalWorkflow({ timeoutMs: 1000 });
    const task = makeTask();

    workflow.request(task);
    expect(workflow.approve(task.id)).toBe(true);
    expect(workflow.isPending(task.id)).toBe(false);

    workflow.request(task);
    expect(workflow.reject(task.id, "not now")).toBe(true);
    expect(workflow.isPending(task.id)).toBe(false);
  });
});
