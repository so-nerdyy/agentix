import type { TaskKind, TaskPriority } from "../powerhouse/types.js";

export interface PlanStep {
  id: string;
  kind: TaskKind;
  priority: TaskPriority;
  payload: Record<string, unknown>;
  requiresApproval: boolean;
  maxAttempts: number;
}

export interface SymphonyPlan {
  id: string;
  stimulus: string;
  steps: PlanStep[];
  createdAt: number;
}

export interface StepValidation {
  stepId: string;
  ok: boolean;
  checks: string[];
  error?: string;
}

export interface SymphonyResult {
  ok: boolean;
  plan: SymphonyPlan;
  outputs: Array<{
    stepId: string;
    taskId: string;
    ok: boolean;
    output?: unknown;
    error?: string;
  }>;
  validations: StepValidation[];
  response: string;
  error?: string;
}
