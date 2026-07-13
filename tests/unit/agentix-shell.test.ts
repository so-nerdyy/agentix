import { describe, expect, it } from "vitest";
import { AgentixShell } from "../../src/shell/AgentixShell.js";

type ShellFormatters = {
  formatPlan(detail: Record<string, unknown> | null): string;
  formatSessionDetail(detail: Record<string, unknown> | null): string;
};

function formatters(): ShellFormatters {
  return new AgentixShell() as unknown as ShellFormatters;
}

describe("AgentixShell formatters", () => {
  it("renders the backend Symphony execution and nested task contract", () => {
    const output = formatters().formatPlan({
      execution: {
        id: "plan-1",
        status: "complete",
        planner: "llm",
        stimulus: "inspect the plan",
      },
      steps: [{
        id: "step-1",
        kind: "luna-message",
        dependsOn: [],
        task: { id: "task-1", status: "complete" },
      }],
      tasks: [{ id: "task-1", status: "complete", kind: "luna-message" }],
      audit: [],
    });

    expect(output).toContain("Plan plan-1 [complete]");
    expect(output).toContain("Planner: llm");
    expect(output).toContain("step-1 [complete] luna-message depends=none task=task-1");
  });

  it("reports missing detail records instead of rendering empty identifiers", () => {
    const shell = formatters();

    expect(shell.formatPlan(null)).toBe("Symphony plan not found.");
    expect(shell.formatSessionDetail(null)).toBe("Session not found.");
  });
});
