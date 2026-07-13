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
  signal?: AbortSignal;
}

export class SymphonyEngine {
  private readonly planner: TaskPlanner;
  private readonly validator: ResultValidator;
  private readonly maxConcurrency: number;

  constructor(opts: { planner?: TaskPlanner; validator?: ResultValidator; maxConcurrency?: number } = {}) {
    this.planner = opts.planner ?? new TaskPlanner();
    this.validator = opts.validator ?? new ResultValidator();
    const configured = Number(opts.maxConcurrency ?? process.env.AGENTIX_SYMPHONY_CONCURRENCY ?? 4);
    this.maxConcurrency = Number.isFinite(configured)
      ? Math.min(16, Math.max(1, Math.floor(configured)))
      : 4;
  }

  async run(
    stimulus: string,
    executor: SymphonyExecutor,
    opts: SymphonyRunOptions = {},
  ): Promise<SymphonyResult> {
    const plan = await this.createPlan(stimulus, opts.signal);
    return this.runPlan(plan, executor, opts);
  }

  async createPlan(stimulus: string, signal?: AbortSignal): Promise<SymphonyResult["plan"]> {
    return this.planner.plan(stimulus, { signal });
  }

  async runPlan(
    plan: SymphonyResult["plan"],
    executor: SymphonyExecutor,
    opts: SymphonyRunOptions = {},
  ): Promise<SymphonyResult> {
    const outputs: SymphonyResult["outputs"] = [...(opts.outputs ?? [])];
    const validations: SymphonyResult["validations"] = [...(opts.validations ?? [])];
    const completed = new Set<string>(opts.completedStepIds ?? []);
    const pending = new Map(
      plan.steps
        .filter((step) => !completed.has(step.id))
        .map((step) => [step.id, step]),
    );

    while (pending.size > 0) {
      if (opts.signal?.aborted) {
        return this.cancelledResult(plan, outputs, validations);
      }
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

      const wave = runnable.slice(0, this.maxConcurrency);
      const outcomes = await Promise.all(
        wave.map(async (step) => {
          const preparedStep = this.withDependencyContext(step, outputs);
          return {
            step,
            outcome: await this.executeWithRetries(preparedStep, plan.id, executor, opts.signal),
          };
        }),
      );
      if (opts.signal?.aborted) {
        for (const { step, outcome } of outcomes) {
          outputs.push(outcome.output);
          validations.push(...outcome.validations);
          pending.delete(step.id);
        }
        return this.cancelledResult(plan, outputs, validations);
      }
      let approval: { stepId: string } | null = null;
      let failure: { stepId: string; error: string } | null = null;

      for (const { step, outcome } of outcomes) {
        outputs.push(outcome.output);
        validations.push(...outcome.validations);
        pending.delete(step.id);

        if (outcome.awaitingApproval) {
          approval ??= { stepId: step.id };
        } else if (!outcome.output.ok) {
          failure ??= {
            stepId: step.id,
            error: outcome.output.error ?? "validation failed",
          };
        } else {
          completed.add(step.id);
        }
      }

      if (failure) {
        return {
          ok: false,
          status: "failed",
          plan,
          outputs,
          validations,
          response: this.formatFailure(failure.stepId, failure.error),
          error: failure.error,
        };
      }

      if (approval) {
        return {
          ok: false,
          status: "awaiting-approval",
          plan,
          outputs,
          validations,
          response: `Approval required before Agentix can continue ${approval.stepId}.`,
          error: "approval_pending",
        };
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
    signal?: AbortSignal,
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
      if (signal?.aborted) {
        return {
          output: lastOutput ?? {
            stepId: currentStep.id,
            taskId: "",
            ok: false,
            error: "cancelled",
            attempts: Math.max(0, attempt - 1),
          },
          validations,
          awaitingApproval: false,
        };
      }
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

      if (signal?.aborted || /cancelled/i.test(result.error ?? "")) {
        return { output: lastOutput, validations, awaitingApproval: false };
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

  private cancelledResult(
    plan: SymphonyResult["plan"],
    outputs: SymphonyResult["outputs"],
    validations: SymphonyResult["validations"],
  ): SymphonyResult {
    return {
      ok: false,
      status: "cancelled",
      plan,
      outputs,
      validations,
      response: "Agentix execution cancelled.",
      error: "cancelled",
    };
  }

  private withDependencyContext(
    step: PlanStep,
    outputs: SymphonyResult["outputs"],
  ): PlanStep {
    if (step.dependsOn.length === 0) return step;
    const dependencyResults = step.dependsOn
      .map((dependencyId) => outputs.find((output) => output.stepId === dependencyId))
      .filter((output): output is SymphonyResult["outputs"][number] => Boolean(output))
      .map((output) => ({
        stepId: output.stepId,
        taskId: output.taskId,
        ok: output.ok,
        output: this.serializeDependencyOutput(output.output),
      }));
    if (dependencyResults.length === 0) return step;

    const dependencyContext = [
      "Completed dependency results:",
      ...dependencyResults.map((result) =>
        `[${result.stepId} / ${result.taskId}]\n${result.output}`,
      ),
    ].join("\n\n").slice(0, 20_000);
    const existingContext = typeof step.payload.context === "string"
      ? step.payload.context.trim()
      : "";

    return {
      ...step,
      payload: {
        ...step.payload,
        dependencyResults,
        context: [existingContext, dependencyContext].filter(Boolean).join("\n\n"),
      },
    };
  }

  private serializeDependencyOutput(output: unknown): string {
    const text = typeof output === "string"
      ? output
      : JSON.stringify(output, null, 2);
    return (text ?? String(output)).slice(0, 6_000);
  }
}
