import { randomUUID } from "node:crypto";
import { loadConfig } from "../config/index.js";
import { LLMClient } from "../llm/LLMClient.js";
import type { PlanStep, SymphonyPlan } from "./types.js";
import type { TaskKind, TaskPriority } from "../powerhouse/types.js";

interface RawPlanStep {
  id?: unknown;
  kind?: unknown;
  priority?: unknown;
  payload?: unknown;
  dependsOn?: unknown;
  requiresApproval?: unknown;
  maxAttempts?: unknown;
}

interface RawPlannerResponse {
  steps?: unknown;
  reasoning?: unknown;
}

export class TaskPlanner {
  async plan(stimulus: string): Promise<SymphonyPlan> {
    const trimmed = stimulus.trim();
    const deterministic = this.planStaticSteps(trimmed);
    if (this.shouldUseStaticOnly(trimmed)) {
      return this.buildPlan(stimulus, deterministic, "static");
    }

    const llmPlan = await this.tryPlanWithLlm(trimmed);
    if (llmPlan.steps.length > 0) {
      return this.buildPlan(stimulus, llmPlan.steps, "llm", llmPlan.reasoning);
    }

    return this.buildPlan(stimulus, deterministic, "static", undefined, llmPlan.error);
  }

  private buildPlan(
    stimulus: string,
    steps: PlanStep[],
    planner: "static" | "llm",
    reasoning?: string,
    fallbackReason?: string,
  ): SymphonyPlan {
    return {
      id: `plan-${randomUUID().slice(0, 8)}`,
      stimulus,
      steps,
      createdAt: Date.now(),
      planner,
      reasoning,
      fallbackReason,
    };
  }

  private planStaticSteps(stimulus: string): PlanStep[] {
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

  private shouldUseStaticOnly(stimulus: string): boolean {
    const lower = stimulus.toLowerCase();
    return (
      lower.startsWith("plan:") ||
      lower.startsWith("run:") ||
      lower.startsWith("sandbox:") ||
      stimulus.startsWith("!")
    );
  }

  private async tryPlanWithLlm(stimulus: string): Promise<{
    steps: PlanStep[];
    reasoning?: string;
    error?: string;
  }> {
    const client = new LLMClient(loadConfig());
    const completion = await client.complete([
      {
        role: "system",
        content: [
          "You are the Agentix Symphony planner.",
          "Return only JSON with keys steps and reasoning.",
          "Allowed step kinds: user-message, bash, code-edit, sandbox-run.",
          "Use user-message for pure conversation or explanation.",
          "Use bash only for explicit shell execution and always set requiresApproval true.",
          "Use code-edit only when a concrete file edit is requested and always set requiresApproval true.",
          "Use sandbox-run only for generated code execution and always set requiresApproval true.",
          "Do not invent file paths or shell commands if the user did not ask for them.",
          "Each step needs id, kind, payload, dependsOn, requiresApproval, maxAttempts, and priority.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          "Create a safe Agentix execution plan for this request.",
          "Schema example:",
          JSON.stringify({
            steps: [
              {
                id: "step-1",
                kind: "user-message",
                priority: "user",
                payload: { stimulus: "answer the user" },
                dependsOn: [],
                requiresApproval: false,
                maxAttempts: 1,
              },
            ],
            reasoning: "short planner rationale",
          }),
          "",
          `Request: ${stimulus}`,
        ].join("\n"),
      },
    ]);

    if (!completion.ok || !completion.text) {
      return { steps: [], error: completion.error ?? "LLM planner returned no text" };
    }

    try {
      const parsed = JSON.parse(this.extractJson(completion.text)) as RawPlannerResponse;
      const steps = this.sanitizePlannerSteps(parsed.steps, stimulus);
      return {
        steps,
        reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 1000) : undefined,
        error: steps.length === 0 ? "LLM planner produced no valid steps" : undefined,
      };
    } catch (err) {
      return {
        steps: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
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
    return kind !== "user-message";
  }

  private extractJson(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
    return trimmed;
  }

  private sanitizePlannerSteps(rawSteps: unknown, stimulus: string): PlanStep[] {
    if (!Array.isArray(rawSteps)) return [];
    const ids = new Set<string>();
    const steps: PlanStep[] = [];

    for (let index = 0; index < Math.min(rawSteps.length, 8); index++) {
      const raw = rawSteps[index] as RawPlanStep;
      if (!raw || typeof raw !== "object") return [];
      const id = this.safeId(raw.id, `step-${index + 1}`);
      if (ids.has(id)) return [];
      const kind = this.safeKind(raw.kind);
      if (!kind) return [];
      const payload = this.safePayload(kind, raw.payload, stimulus);
      if (!payload) return [];
      const dependsOn = this.safeDependsOn(raw.dependsOn, ids);
      if (!dependsOn) return [];
      const step: PlanStep = {
        id,
        kind,
        priority: this.safePriority(raw.priority),
        payload,
        dependsOn,
        requiresApproval: this.safeApproval(kind, raw.requiresApproval),
        maxAttempts: this.safeAttempts(raw.maxAttempts),
      };
      ids.add(id);
      steps.push(step);
    }

    return steps;
  }

  private safeId(value: unknown, fallback: string): string {
    const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback;
    return candidate.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 48) || fallback;
  }

  private safeKind(value: unknown): TaskKind | null {
    if (
      value === "user-message" ||
      value === "bash" ||
      value === "code-edit" ||
      value === "sandbox-run"
    ) {
      return value;
    }
    return null;
  }

  private safePriority(value: unknown): TaskPriority {
    return value === "background" ? "background" : "user";
  }

  private safeDependsOn(value: unknown, previousIds: Set<string>): string[] | null {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) return null;
    const deps = value.map((item) => String(item));
    return deps.every((dep) => previousIds.has(dep)) ? deps : null;
  }

  private safeApproval(kind: TaskKind, value: unknown): boolean {
    if (kind === "bash" || kind === "code-edit" || kind === "sandbox-run") return true;
    return Boolean(value);
  }

  private safeAttempts(value: unknown): number {
    const attempts = Number(value);
    if (!Number.isFinite(attempts)) return 1;
    return Math.min(3, Math.max(1, Math.floor(attempts)));
  }

  private safePayload(
    kind: TaskKind,
    value: unknown,
    stimulus: string,
  ): Record<string, unknown> | null {
    const payload = value && typeof value === "object" && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};

    if (kind === "user-message") {
      return {
        ...payload,
        stimulus: typeof payload.stimulus === "string" && payload.stimulus.trim()
          ? payload.stimulus
          : stimulus,
      };
    }

    if (kind === "bash") {
      const commandLine = typeof payload.commandLine === "string"
        ? payload.commandLine.trim()
        : typeof payload.command === "string"
          ? [payload.command, ...(Array.isArray(payload.args) ? payload.args : [])].join(" ").trim()
          : "";
      if (!commandLine) return null;
      return this.parseShell(commandLine);
    }

    if (kind === "code-edit") {
      const hasFile = typeof payload.file === "string" && payload.file.trim();
      const hasNewContent = typeof payload.newContent === "string";
      const hasFindReplace = typeof payload.find === "string" && typeof payload.replace === "string";
      return hasFile && (hasNewContent || hasFindReplace) ? payload : null;
    }

    if (kind === "sandbox-run") {
      if (typeof payload.code !== "string" || !payload.code.trim()) return null;
      return {
        ...payload,
        filename: typeof payload.filename === "string" && payload.filename.trim()
          ? payload.filename
          : "snippet.js",
        command: Array.isArray(payload.command) && payload.command.length > 0
          ? payload.command.map((item) => String(item))
          : ["node", typeof payload.filename === "string" && payload.filename.trim() ? payload.filename : "snippet.js"],
      };
    }

    return null;
  }
}
