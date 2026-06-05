import { randomUUID } from "node:crypto";
import type { PlanStep, SymphonyPlan } from "./types.js";

export class TaskPlanner {
  plan(stimulus: string): SymphonyPlan {
    const trimmed = stimulus.trim();
    const steps = this.planSteps(trimmed);

    return {
      id: `plan-${randomUUID().slice(0, 8)}`,
      stimulus,
      steps,
      createdAt: Date.now(),
    };
  }

  private planSteps(stimulus: string): PlanStep[] {
    const parsed = this.tryParsePlan(stimulus);
    if (parsed.length > 0) return parsed;

    if (stimulus.toLowerCase().startsWith("run:") && stimulus.includes("&&")) {
      const commands = stimulus
        .slice(4)
        .split("&&")
        .map((item) => item.trim())
        .filter(Boolean);
      return commands.map((command, index) => ({
        id: `step-${index + 1}`,
        kind: "bash",
        priority: "user",
        payload: this.parseShell(command),
        dependsOn: index === 0 ? [] : [`step-${index}`],
        requiresApproval: true,
        maxAttempts: 1,
      }));
    }

    return [this.planSingleStep(stimulus)];
  }

  private planSingleStep(stimulus: string): PlanStep {
    if (stimulus.startsWith("!")) {
      return {
        id: "step-1",
        kind: "bash",
        priority: "user",
        payload: this.parseShell(stimulus.slice(1).trim()),
        dependsOn: [],
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
        dependsOn: [],
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
        dependsOn: [],
        requiresApproval: true,
        maxAttempts: 2,
      };
    }

    return {
      id: "step-1",
      kind: "user-message",
      priority: "user",
      payload: { stimulus },
      dependsOn: [],
      requiresApproval: false,
      maxAttempts: 1,
    };
  }

  private tryParsePlan(stimulus: string): PlanStep[] {
    if (!stimulus.trim().toLowerCase().startsWith("plan:")) return [];
    try {
      const raw = JSON.parse(stimulus.slice(stimulus.indexOf(":") + 1).trim()) as {
        steps?: Array<Partial<PlanStep>>;
      };
      if (!Array.isArray(raw.steps)) return [];
      return raw.steps.map((step, index) => ({
        id: step.id ?? `step-${index + 1}`,
        kind: step.kind ?? "user-message",
        priority: step.priority ?? "user",
        payload: step.payload ?? {},
        dependsOn: step.dependsOn ?? [],
        requiresApproval: step.requiresApproval ?? this.requiresApprovalByDefault(step.kind),
        maxAttempts: step.maxAttempts ?? 1,
      }));
    } catch {
      return [];
    }
  }

  private parseShell(commandLine: string): Record<string, unknown> {
    const parts = commandLine.match(/"[^"]+"|'[^']+'|\S+/g) ?? [];
    const [command, ...args] = parts.map((part) =>
      part.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"),
    );
    return { command, args, commandLine };
  }

  private requiresApprovalByDefault(kind?: string): boolean {
    return kind === "bash" || kind === "code-edit" || kind === "sandbox-run";
  }
}
