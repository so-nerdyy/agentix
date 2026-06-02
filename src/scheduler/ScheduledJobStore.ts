import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PATHS } from "../config/paths.js";
import { JsonFileStore } from "../storage/JsonFileStore.js";

export interface ScheduledJob {
  id: string;
  name: string;
  stimulus: string;
  enabled: boolean;
  intervalMs: number;
  nextRunAt: number;
  lastRunAt?: number;
  runCount: number;
  createdAt: number;
  updatedAt: number;
}

interface ScheduledJobFile {
  jobs: ScheduledJob[];
}

export class ScheduledJobStore {
  private readonly store: JsonFileStore<ScheduledJobFile>;

  constructor(file = join(PATHS.dataDir, "scheduler", "jobs.json")) {
    this.store = new JsonFileStore(file, { jobs: [] });
  }

  create(input: {
    name: string;
    stimulus: string;
    intervalMs: number;
    enabled?: boolean;
  }): ScheduledJob {
    const now = Date.now();
    const job: ScheduledJob = {
      id: `job-${randomUUID().slice(0, 8)}`,
      name: input.name,
      stimulus: input.stimulus,
      enabled: input.enabled ?? true,
      intervalMs: Math.max(1_000, input.intervalMs),
      nextRunAt: now + Math.max(1_000, input.intervalMs),
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.store.update((current) => ({ jobs: [...current.jobs, job] }));
    return job;
  }

  list(): ScheduledJob[] {
    return this.store.read().jobs;
  }

  get(id: string): ScheduledJob | undefined {
    return this.list().find((job) => job.id === id);
  }

  update(id: string, patch: Partial<ScheduledJob>): ScheduledJob | undefined {
    let updated: ScheduledJob | undefined;
    this.store.update((current) => ({
      jobs: current.jobs.map((job) => {
        if (job.id !== id) return job;
        updated = { ...job, ...patch, updatedAt: Date.now() };
        return updated;
      }),
    }));
    return updated;
  }

  remove(id: string): boolean {
    let removed = false;
    this.store.update((current) => {
      const jobs = current.jobs.filter((job) => job.id !== id);
      removed = jobs.length !== current.jobs.length;
      return { jobs };
    });
    return removed;
  }
}
