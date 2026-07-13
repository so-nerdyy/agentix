import { describe, expect, it, vi } from "vitest";
import { SymphonyEngine } from "../../src/symphony/SymphonyEngine.js";
import type { SymphonyPlan } from "../../src/symphony/types.js";

function plan(steps: SymphonyPlan["steps"]): SymphonyPlan {
  return {
    id: "plan-test",
    stimulus: "parallel test",
    steps,
    createdAt: Date.now(),
    planner: "static",
  };
}

function step(id: string, dependsOn: string[] = []): SymphonyPlan["steps"][number] {
  return {
    id,
    kind: "user-message",
    priority: "user",
    payload: { stimulus: id },
    dependsOn,
    requiresApproval: false,
    maxAttempts: 1,
  };
}

describe("SymphonyEngine scheduling", () => {
  it("runs independent steps concurrently and preserves plan-order output", async () => {
    const engine = new SymphonyEngine({ maxConcurrency: 4 });
    const started = new Set<string>();
    let synthesisContext = "";
    let releaseWave!: () => void;
    const waveReleased = new Promise<void>((resolve) => {
      releaseWave = resolve;
    });
    const execution = engine.runPlan(plan([
      step("alpha"),
      step("beta"),
      step("synthesis", ["alpha", "beta"]),
    ]), {
      executeStep: async (current) => {
        started.add(current.id);
        if (current.id === "synthesis") {
          synthesisContext = String(current.payload.context ?? "");
        }
        if (current.id !== "synthesis") await waveReleased;
        return {
          taskId: `task-${current.id}`,
          result: { ok: true, output: `output-${current.id}` },
        };
      },
    });

    try {
      await vi.waitFor(() => expect([...started].sort()).toEqual(["alpha", "beta"]), {
        timeout: 1000,
        interval: 5,
      });
    } finally {
      releaseWave();
    }

    const result = await execution;
    expect(result.status).toBe("complete");
    expect(result.outputs.map((output) => output.stepId)).toEqual([
      "alpha",
      "beta",
      "synthesis",
    ]);
    expect(started.has("synthesis")).toBe(true);
    expect(synthesisContext).toContain("output-alpha");
    expect(synthesisContext).toContain("output-beta");
  });

  it("never exceeds its configured concurrency limit", async () => {
    const engine = new SymphonyEngine({ maxConcurrency: 2 });
    let active = 0;
    let peak = 0;
    const result = await engine.runPlan(plan([
      step("one"),
      step("two"),
      step("three"),
      step("four"),
      step("five"),
    ]), {
      executeStep: async (current) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return {
          taskId: `task-${current.id}`,
          result: { ok: true, output: current.id },
        };
      },
    });

    expect(result.status).toBe("complete");
    expect(peak).toBe(2);
    expect(result.outputs).toHaveLength(5);
  });

  it("does not retry or recover a step after cancellation", async () => {
    const engine = new SymphonyEngine();
    const controller = new AbortController();
    let calls = 0;
    let recoveries = 0;
    const cancellable = step("cancel-me");
    cancellable.maxAttempts = 3;

    const result = await engine.runPlan(plan([cancellable]), {
      executeStep: async () => {
        calls += 1;
        controller.abort(new Error("user interrupted"));
        return { taskId: "task-cancelled", result: { ok: false, error: "cancelled" } };
      },
      recoverStep: () => {
        recoveries += 1;
        return cancellable;
      },
    }, { signal: controller.signal });

    expect(result.status).toBe("cancelled");
    expect(calls).toBe(1);
    expect(recoveries).toBe(0);
  });
});
