import { AuditLog } from "../audit/AuditLog.js";
import type { Powerhouse } from "../powerhouse/Powerhouse.js";
import { computeNextRun, parseScheduleInput } from "./CronSchedule.js";
import { ScheduledJobStore, type ScheduledJob } from "./ScheduledJobStore.js";

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly powerhouse: Powerhouse,
    readonly jobs = new ScheduledJobStore(),
    private readonly audit = new AuditLog(),
  ) {}

  start(intervalMs = 30_000): void {
    this.stop();
    const timer = setInterval(() => {
      this.runDue().catch((err) => {
        this.audit.record({
          type: "scheduler.error",
          actor: "scheduler",
          data: { error: err instanceof Error ? err.message : String(err) },
        });
      });
    }, intervalMs);
    timer.unref?.();
    this.timer = timer;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  create(input: {
    name: string;
    stimulus: string;
    schedule?: string;
    intervalMs?: number;
    enabled?: boolean;
  }): ScheduledJob {
    const job = this.jobs.create(input);
    this.audit.record({
      type: "scheduler.job_created",
      actor: "user",
      subjectId: job.id,
      data: { name: job.name, schedule: job.scheduleDisplay },
    });
    return job;
  }

  list(): ScheduledJob[] {
    return this.jobs.list();
  }

  setEnabled(id: string, enabled: boolean): ScheduledJob | undefined {
    const existing = this.jobs.get(id);
    const nextRunAt = existing && enabled && existing.nextRunAt === null
      ? computeNextRun({
          schedule: existing.schedule,
          scheduleKind: existing.scheduleKind,
          intervalMs: existing.intervalMs,
          runAt: existing.runAt,
          now: Date.now(),
        })
      : existing?.nextRunAt;
    const job = this.jobs.update(id, { enabled, nextRunAt });
    if (job) {
      this.audit.record({
        type: enabled ? "scheduler.job_enabled" : "scheduler.job_disabled",
        actor: "user",
        subjectId: id,
        data: {},
      });
    }
    return job;
  }

  update(id: string, input: {
    name?: string;
    stimulus?: string;
    schedule?: string;
    intervalMs?: number;
    enabled?: boolean;
  }): ScheduledJob | undefined {
    const existing = this.jobs.get(id);
    if (!existing) return undefined;

    const patch: Partial<ScheduledJob> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.stimulus !== undefined) patch.stimulus = input.stimulus;
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.schedule !== undefined || input.intervalMs !== undefined) {
      const schedule = parseScheduleInput({
        schedule: input.schedule ?? existing.schedule,
        intervalMs: input.intervalMs ?? existing.intervalMs,
      });
      patch.schedule = schedule.schedule;
      patch.scheduleKind = schedule.scheduleKind;
      patch.scheduleDisplay = schedule.scheduleDisplay;
      patch.intervalMs = schedule.intervalMs;
      patch.runAt = schedule.runAt;
      patch.nextRunAt = schedule.nextRunAt;
      patch.lastError = undefined;
    }

    const job = this.jobs.update(id, patch);
    if (job) {
      this.audit.record({
        type: "scheduler.job_updated",
        actor: "user",
        subjectId: id,
        data: { name: job.name, schedule: job.scheduleDisplay, enabled: job.enabled },
      });
    }
    return job;
  }

  remove(id: string): boolean {
    const removed = this.jobs.remove(id);
    if (removed) {
      this.audit.record({ type: "scheduler.job_removed", actor: "user", subjectId: id, data: {} });
    }
    return removed;
  }

  async runNow(id: string): Promise<{ ok: boolean; job?: ScheduledJob; error?: string }> {
    const job = this.jobs.get(id);
    if (!job) return { ok: false, error: `unknown scheduled job: ${id}` };
    const result = await this.execute(job);
    return { ok: result.ok, job: this.jobs.get(id), error: result.error };
  }

  async runDue(now = Date.now()): Promise<ScheduledJob[]> {
    const due = this.jobs
      .list()
      .filter((job) => job.enabled && job.nextRunAt !== null && job.nextRunAt <= now);
    for (const job of due) {
      await this.execute(job, now);
    }
    return due;
  }

  private async execute(job: ScheduledJob, now = Date.now()): Promise<{ ok: boolean; error?: string }> {
    const fresh = this.jobs.get(job.id) ?? job;
    if (fresh.running) {
      this.audit.record({
        type: "scheduler.job_skipped",
        actor: "scheduler",
        subjectId: job.id,
        data: { reason: "already running" },
      });
      return { ok: false, error: "job already running" };
    }

    this.jobs.update(job.id, { running: true, lastError: undefined });
    this.audit.record({
      type: "scheduler.job_started",
      actor: "scheduler",
      subjectId: job.id,
      data: { stimulus: fresh.stimulus, schedule: fresh.scheduleDisplay },
    });

    try {
      const result = await this.powerhouse.executeStimulus({
        stimulus: fresh.stimulus,
      });
      const completedAt = Date.now();
      const nextRunAt = computeNextRun({
        schedule: fresh.schedule,
        scheduleKind: fresh.scheduleKind,
        intervalMs: fresh.intervalMs,
        runAt: fresh.runAt,
        lastRunAt: completedAt,
        now: completedAt,
      });
      const completedJob = this.jobs.update(job.id, {
        running: false,
        lastRunAt: completedAt,
        nextRunAt,
        enabled: nextRunAt === null ? false : fresh.enabled,
        runCount: fresh.runCount + 1,
        lastStatus: result.status === "failed" ? "failure" : "success",
        lastError: result.status === "failed" ? result.response : undefined,
        lastTaskIds: result.taskIds,
      });
      this.audit.record({
        type: result.status === "failed" ? "scheduler.job_failed" : "scheduler.job_completed",
        actor: "scheduler",
        subjectId: job.id,
        data: {
          status: result.status,
          taskIds: result.taskIds,
          nextRunAt: completedJob?.nextRunAt ?? null,
        },
      });
      return { ok: result.status !== "failed", error: result.status === "failed" ? result.response : undefined };
    } catch (err) {
      const completedAt = Date.now();
      const error = err instanceof Error ? err.message : String(err);
      const nextRunAt = computeNextRun({
        schedule: fresh.schedule,
        scheduleKind: fresh.scheduleKind,
        intervalMs: fresh.intervalMs,
        runAt: fresh.runAt,
        lastRunAt: completedAt,
        now: completedAt,
      });
      this.jobs.update(job.id, {
        running: false,
        lastRunAt: completedAt,
        nextRunAt,
        enabled: nextRunAt === null ? false : fresh.enabled,
        runCount: fresh.runCount + 1,
        lastStatus: "failure",
        lastError: error,
      });
      this.audit.record({
        type: "scheduler.job_failed",
        actor: "scheduler",
        subjectId: job.id,
        data: { error, nextRunAt },
      });
      return { ok: false, error };
    }
  }
}
