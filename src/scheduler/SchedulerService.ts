import { AuditLog } from "../audit/AuditLog.js";
import type { Powerhouse } from "../powerhouse/Powerhouse.js";
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
    intervalMs: number;
    enabled?: boolean;
  }): ScheduledJob {
    const job = this.jobs.create(input);
    this.audit.record({
      type: "scheduler.job_created",
      actor: "user",
      subjectId: job.id,
      data: { name: job.name, intervalMs: job.intervalMs },
    });
    return job;
  }

  list(): ScheduledJob[] {
    return this.jobs.list();
  }

  setEnabled(id: string, enabled: boolean): ScheduledJob | undefined {
    const job = this.jobs.update(id, { enabled });
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
    await this.execute(job);
    return { ok: true, job: this.jobs.get(id) };
  }

  async runDue(now = Date.now()): Promise<ScheduledJob[]> {
    const due = this.jobs
      .list()
      .filter((job) => job.enabled && job.nextRunAt <= now);
    for (const job of due) {
      await this.execute(job, now);
    }
    return due;
  }

  private async execute(job: ScheduledJob, now = Date.now()): Promise<void> {
    this.audit.record({
      type: "scheduler.job_started",
      actor: "scheduler",
      subjectId: job.id,
      data: { stimulus: job.stimulus },
    });
    const result = await this.powerhouse.executeStimulus({
      stimulus: job.stimulus,
    });
    this.jobs.update(job.id, {
      lastRunAt: now,
      nextRunAt: now + job.intervalMs,
      runCount: job.runCount + 1,
    });
    this.audit.record({
      type: "scheduler.job_completed",
      actor: "scheduler",
      subjectId: job.id,
      data: { status: result.status, taskIds: result.taskIds },
    });
  }
}
