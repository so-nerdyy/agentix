import { randomUUID } from "node:crypto";
import type { PlanStep, SymphonyPlan } from "./types.js";

export class TaskPlanner {
  plan(stimulus: string): SymphonyPlan {
    const trimmed = stimulus.trim();
    const step = this.planSingleStep(trimmed);

    return {
      id: `plan-${randomUUID().slice(0, 8)}`,
      stimulus,
      steps: [step],
      createdAt: Date.now(),
    };
  }

  private planSingleStep(stimulus: string): PlanStep {
    if (stimulus.startsWith("!")) {
      return {
        id: "step-1",
        kind: "bash",
        priority: "user",
        payload: this.parseShell(stimulus.slice(1).trim()),
        requiresApproval: true,
        maxAttempts: 1,
      };
    }

    if (stimulus.toLowerCase().startsWith("run:")) {
      return {
        id: "step-1",
        kind: "bash",
        priority: "user",
        payload: this.parseShell(stimulus.slice(4).trim()),
        requiresApproval: true,
        maxAttempts: 1,
      };
    }

    if (stimulus.toLowerCase().startsWith("sandbox:")) {
      return {
        id: "step-1",
        kind: "sandbox-run",
        priority: "user",
        payload: {
          code: stimulus.slice("sandbox:".length).trim(),
          filename: "snippet.js",
          command: ["node", "snippet.js"],
        },
        requiresApproval: false,
        maxAttempts: 2,
      };
    }

    return {
      id: "step-1",
      kind: "user-message",
      priority: "user",
      payload: { stimulus },
      requiresApproval: false,
      maxAttempts: 1,
    };
  }

  private parseShell(commandLine: string): Record<string, unknown> {
    const parts = commandLine.match(/"[^"]+"|'[^']+'|\S+/g) ?? [];
    const [command, ...args] = parts.map((part) =>
      part.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"),
    );
    return { command, args };
  }
}
