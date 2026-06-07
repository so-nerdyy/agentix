import { join } from "node:path";
import { PATHS } from "../config/paths.js";
import { JsonFileStore } from "../storage/JsonFileStore.js";
import type { SymphonyPlan } from "./types.js";

export interface StoredPlanExecution {
  plan: SymphonyPlan;
  sessionId: string;
  taskIds: string[];
  status: "complete" | "awaiting-approval" | "failed";
  createdAt: number;
  updatedAt: number;
}

interface PlanStoreFile {
  executions: StoredPlanExecution[];
}

export class PlanStore {
  private readonly store: JsonFileStore<PlanStoreFile>;

  constructor(file = join(PATHS.dataDir, "plans", "plans.json")) {
    this.store = new JsonFileStore(file, { executions: [] });
  }

  upsert(input: {
    plan: SymphonyPlan;
    sessionId: string;
    taskIds: string[];
    status: StoredPlanExecution["status"];
  }): StoredPlanExecution {
    const now = Date.now();
    const taskIds = Array.from(new Set(input.taskIds));
    let saved: StoredPlanExecution | undefined;
    this.store.update((current) => {
      const existing = current.executions.find((item) => item.plan.id === input.plan.id);
      saved = {
        plan: input.plan,
        sessionId: input.sessionId,
        taskIds,
        status: input.status,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      return {
        executions: [
          ...current.executions.filter((item) => item.plan.id !== input.plan.id),
          saved,
        ],
      };
    });
    return saved!;
  }

  get(planId: string): StoredPlanExecution | undefined {
    return this.store.read().executions.find((item) => item.plan.id === planId);
  }

  list(): StoredPlanExecution[] {
    return this.store.read().executions.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
