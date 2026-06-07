import type { TaskKind, TaskPriority } from "../powerhouse/types.js";

export interface PlanStep {
  id: string;
  kind: TaskKind;
  priority: TaskPriority;
  payload: Record<string, unknown>;
  dependsOn: string[];
  requiresApproval: boolean;
  maxAttempts: number;
}

export interface SymphonyPlan {
  id: string;
  stimulus: string;
  steps: PlanStep[];
  createdAt: number;
  planner: "static" | "llm";
  reasoning?: string;
  fallbackReason?: string;
}

export interface StepValidation {
  stepId: string;
  ok: boolean;
  checks: string[];
  error?: string;
}

export interface SymphonyResult {
  ok: boolean;
  status: "complete" | "awaiting-approval" | "failed";
  plan: SymphonyPlan;
  outputs: Array<{
    stepId: string;
    taskId: string;
    ok: boolean;
    output?: unknown;
    error?: string;
    attempts: number;
  }>;
  validations: StepValidation[];
  response: string;
  error?: string;
}
