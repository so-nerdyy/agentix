import { describe, expect, it } from "vitest";
import { BasePIAgent } from "../../src/pi/BasePIAgent.js";
import { PIAgentRegistry } from "../../src/powerhouse/PIAgentRegistry.js";
import type { Task, TaskResult } from "../../src/powerhouse/types.js";

class DummyAgent extends BasePIAgent {
  shutdownCalled = false;

  constructor() {
    super("bash", "dummy-agent");
  }

  async execute(_task: Task): Promise<TaskResult> {
    return { ok: true, output: "done" };
  }

  shutdown(): void {
    this.shutdownCalled = true;
  }
}

describe("PIAgentRegistry", () => {
  it("routes by task kind and shuts agents down", () => {
    const registry = new PIAgentRegistry();
    const agent = new DummyAgent();

    registry.register(agent);

    const task = {
      id: "task-1",
      sessionId: "sess-1",
      kind: "bash",
      priority: "user",
      status: "queued",
      payload: {},
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: 1,
      requiresApproval: false,
    } satisfies Task;

    expect(registry.pickFor(task)).toBe(agent);
    expect(registry.get(agent.id)).toBe(agent);
    expect(registry.list()).toHaveLength(1);

    registry.shutdown();
    expect(agent.shutdownCalled).toBe(true);
    expect(registry.list()).toHaveLength(0);
  });
});
