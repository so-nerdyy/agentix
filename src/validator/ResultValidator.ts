import type { TaskResult } from "../powerhouse/types.js";
import type { StepValidation } from "../symphony/types.js";

export class ResultValidator {
  validate(stepId: string, result: TaskResult | undefined): StepValidation {
    const checks: string[] = [];

    if (!result) {
      return {
        stepId,
        ok: false,
        checks: ["result_present:fail"],
        error: "missing task result",
      };
    }
    checks.push("result_present:pass");

    if (!result.ok) {
      return {
        stepId,
        ok: false,
        checks: [...checks, "status:fail"],
        error: result.error ?? "task returned failure",
      };
    }
    checks.push("status:pass");

    if (result.output === undefined || result.output === null) {
      return {
        stepId,
        ok: false,
        checks: [...checks, "output_present:fail"],
        error: "task output is empty",
      };
    }
    checks.push("output_present:pass");

    return { stepId, ok: true, checks };
  }
}
