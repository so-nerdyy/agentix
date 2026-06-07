import { TaskPlanner } from "./TaskPlanner.js";
import { ResultValidator } from "../validator/ResultValidator.js";
import type { TaskResult } from "../powerhouse/types.js";
import type { PlanStep, SymphonyResult } from "./types.js";

export interface SymphonyExecutor {
  executeStep(step: PlanStep, planId: string): Promise<{
    taskId: string;
    result: TaskResult;
  }>;
  recoverStep?(step: PlanStep, failure: {
    taskId: string;
    error: string;
    attempt: number;
    result: TaskResult;
  }): Promise<PlanStep | null> | PlanStep | null;
}

export interface SymphonyRunOptions {
  completedStepIds?: Iterable<string>;
  outputs?: SymphonyResult["outputs"];
  validations?: SymphonyResult["validations"];
}

export class SymphonyEngine {
  private readonly planner: TaskPlanner;
  private readonly validator: ResultValidator;

  constructor(opts: { planner?: TaskPlanner; validator?: ResultValidator } = {}) {
    this.planner = opts.planner ?? new TaskPlanner();
    this.validator = opts.validator ?? new ResultValidator();
  }

  async run(stimulus: string, executor: SymphonyExecutor): Promise<SymphonyResult> {
    const plan = await this.planner.plan(stimulus);
    return this.runPlan(plan, executor);
  }

  async runPlan(
    plan: SymphonyResult["plan"],
    executor: SymphonyExecutor,
    opts: SymphonyRunOptions = {},
  ): Promise<SymphonyResult> {
    const outputs: SymphonyResult["outputs"] = [...(opts.outputs ?? [])];
    const validations: SymphonyResult["validations"] = [...(opts.validations ?? [])];
    const completed = new Set<string>(opts.completedStepIds ?? []);
    const failed = new Set<string>();
    const pending = new Map(
      plan.steps
        .filter((step) => !completed.has(step.id))
        .map((step) => [step.id, step]),
    );

    while (pending.size > 0) {
      const runnable = Array.from(pending.values()).filter((step) =>
        step.dependsOn.every((dep) => completed.has(dep)),
      );

      if (runnable.length === 0) {
        const blocked = Array.from(pending.keys()).join(", ");
        return {
          ok: false,
          status: "failed",
          plan,
          outputs,
          validations,
          response: `Agentix could not schedule remaining steps: ${blocked}`,
          error: `unsatisfied dependencies for ${blocked}`,
        };
      }

      for (const step of runnable) {
        const outcome = await this.executeWithRetries(step, plan.id, executor);
        outputs.push(outcome.output);
        validations.push(...outcome.validations);
        pending.delete(step.id);

        if (outcome.awaitingApproval) {
          return {
            ok: false,
            status: "awaiting-approval",
            plan,
            outputs,
            validations,
            response: `Approval required before Agentix can continue ${step.id}.`,
            error: "approval_pending",
          };
        }

        if (!outcome.output.ok) {
          failed.add(step.id);
          return {
            ok: false,
            status: "failed",
            plan,
            outputs,
            validations,
            response: this.formatFailure(step.id, outcome.output.error ?? "validation failed"),
            error: outcome.output.error,
          };
        }

        completed.add(step.id);
      }
    }

    return {
      ok: true,
      status: "complete",
      plan,
      outputs,
      validations,
      response: this.formatSuccess(outputs),
    };
  }

  private async executeWithRetries(
    step: PlanStep,
    planId: string,
    executor: SymphonyExecutor,
  ): Promise<{
    output: SymphonyResult["outputs"][number];
    validations: SymphonyResult["validations"];
    awaitingApproval: boolean;
  }> {
    const validations: SymphonyResult["validations"] = [];
    let lastOutput: SymphonyResult["outputs"][number] | null = null;
    const maxAttempts = Math.max(1, step.maxAttempts);
    let currentStep = step;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { taskId, result } = await executor.executeStep(currentStep, planId);
      const validation = this.validator.validate(currentStep.id, result);
      validations.push(validation);
      lastOutput = {
        stepId: currentStep.id,
        taskId,
        ok: result.ok,
        output: result.output,
        error: validation.error ?? result.error,
        attempts: attempt,
      };

      if (validation.error === "approval_pending") {
        return { output: lastOutput, validations, awaitingApproval: true };
      }

      if (validation.ok) {
        return { output: lastOutput, validations, awaitingApproval: false };
      }

      if (attempt < maxAttempts && executor.recoverStep) {
        const error = validation.error ?? result.error ?? "validation failed";
        const recovered = await executor.recoverStep(currentStep, {
          taskId,
          error,
          attempt,
          result,
        });
        if (recovered) {
          currentStep = recovered;
        }
      }
    }

    return {
      output: lastOutput ?? {
        stepId: step.id,
        taskId: "",
        ok: false,
        error: "step did not execute",
        attempts: 0,
      },
      validations,
      awaitingApproval: false,
    };
  }

  private formatSuccess(outputs: SymphonyResult["outputs"]): string {
    return outputs
      .map((output) =>
        typeof output.output === "string"
          ? output.output
          : JSON.stringify(output.output, null, 2),
      )
      .join("\n\n");
  }

  private formatFailure(stepId: string, error: string): string {
    return `Agentix failed while executing ${stepId}: ${error}`;
  }
}
