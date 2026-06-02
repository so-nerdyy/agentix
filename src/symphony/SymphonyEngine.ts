import { TaskPlanner } from "./TaskPlanner.js";
import { ResultValidator } from "../validator/ResultValidator.js";
import type { TaskResult } from "../powerhouse/types.js";
import type { PlanStep, SymphonyResult } from "./types.js";

export interface SymphonyExecutor {
  executeStep(step: PlanStep): Promise<{
    taskId: string;
    result: TaskResult;
  }>;
}

export class SymphonyEngine {
  private readonly planner: TaskPlanner;
  private readonly validator: ResultValidator;

  constructor(opts: { planner?: TaskPlanner; validator?: ResultValidator } = {}) {
    this.planner = opts.planner ?? new TaskPlanner();
    this.validator = opts.validator ?? new ResultValidator();
  }

  async run(stimulus: string, executor: SymphonyExecutor): Promise<SymphonyResult> {
    const plan = this.planner.plan(stimulus);
    const outputs: SymphonyResult["outputs"] = [];
    const validations: SymphonyResult["validations"] = [];

    for (const step of plan.steps) {
      const { taskId, result } = await executor.executeStep(step);
      const validation = this.validator.validate(step.id, result);
      outputs.push({
        stepId: step.id,
        taskId,
        ok: result.ok,
        output: result.output,
        error: result.error,
      });
      validations.push(validation);

      if (!validation.ok) {
        return {
          ok: false,
          plan,
          outputs,
          validations,
          response: this.formatFailure(step.id, validation.error ?? result.error ?? "validation failed"),
          error: validation.error ?? result.error,
        };
      }
    }

    return {
      ok: true,
      plan,
      outputs,
      validations,
      response: this.formatSuccess(outputs),
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
