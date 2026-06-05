import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PATHS } from "../config/paths.js";
import { JsonFileStore } from "../storage/JsonFileStore.js";
import { parseScheduleInput, scheduleSummary, type ScheduleKind } from "./CronSchedule.js";

export interface ScheduledJob {
  id: string;
  name: string;
  stimulus: string;
  enabled: boolean;
  schedule: string;
  scheduleKind: ScheduleKind;
  scheduleDisplay: string;
  intervalMs: number;
  runAt?: number;
  nextRunAt: number | null;
  script?: string;
  noAgent?: boolean;
  workdir?: string;
  skills?: string[];
  lastRunAt?: number;
  lastStatus?: "success" | "failure";
  lastError?: string;
  lastOutput?: string;
  lastTaskIds?: string[];
  running?: boolean;
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
    schedule?: string;
    intervalMs?: number;
    script?: string;
    noAgent?: boolean;
    workdir?: string;
    skills?: string[];
    enabled?: boolean;
  }): ScheduledJob {
    const now = Date.now();
    const schedule = parseScheduleInput(input, now);
    const job: ScheduledJob = {
      id: `job-${randomUUID().slice(0, 8)}`,
      name: input.name,
      stimulus: input.stimulus,
      enabled: input.enabled ?? true,
      schedule: schedule.schedule,
      scheduleKind: schedule.scheduleKind,
      scheduleDisplay: schedule.scheduleDisplay,
      intervalMs: schedule.intervalMs,
      runAt: schedule.runAt,
      nextRunAt: schedule.nextRunAt,
      script: input.script,
      noAgent: input.noAgent,
      workdir: input.workdir,
      skills: input.skills,
      running: false,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.store.update((current) => ({ jobs: [...current.jobs, job] }));
    return job;
  }

  list(): ScheduledJob[] {
    return this.store.read().jobs.map((job) => this.normalize(job));
  }

  get(id: string): ScheduledJob | undefined {
    return this.list().find((job) => job.id === id);
  }

  update(id: string, patch: Partial<ScheduledJob>): ScheduledJob | undefined {
    let updated: ScheduledJob | undefined;
    this.store.update((current) => ({
      jobs: current.jobs.map((job) => {
        if (job.id !== id) return job;
        updated = { ...this.normalize(job), ...patch, updatedAt: Date.now() };
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

  private normalize(job: ScheduledJob): ScheduledJob {
    if (job.schedule && job.scheduleKind && job.scheduleDisplay) {
      return {
        ...job,
        intervalMs: Math.max(1_000, Number(job.intervalMs ?? 60_000)),
        nextRunAt: job.nextRunAt ?? null,
        running: Boolean(job.running),
      };
    }

    const intervalMs = Math.max(1_000, Number(job.intervalMs ?? 60_000));
    return {
      ...job,
      schedule: job.schedule ?? `every ${Math.round(intervalMs / 1_000)}s`,
      scheduleKind: job.scheduleKind ?? "interval",
      scheduleDisplay: scheduleSummary({ intervalMs }),
      intervalMs,
      nextRunAt: job.nextRunAt ?? Date.now() + intervalMs,
      running: Boolean(job.running),
    };
  }
}
