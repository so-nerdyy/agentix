import { AuditLog } from "../audit/AuditLog.js";
import type { Powerhouse } from "../powerhouse/Powerhouse.js";
import { computeNextRun, parseScheduleInput } from "./CronSchedule.js";
import { ScheduledJobStore, type ScheduledJob } from "./ScheduledJobStore.js";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { PATHS } from "../config/paths.js";

interface ScriptRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

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
    script?: string;
    noAgent?: boolean;
    workdir?: string;
    skills?: string[];
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
    script?: string | null;
    noAgent?: boolean;
    workdir?: string | null;
    skills?: string[];
    enabled?: boolean;
  }): ScheduledJob | undefined {
    const existing = this.jobs.get(id);
    if (!existing) return undefined;

    const patch: Partial<ScheduledJob> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.stimulus !== undefined) patch.stimulus = input.stimulus;
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.script !== undefined) patch.script = input.script ?? undefined;
    if (input.noAgent !== undefined) patch.noAgent = input.noAgent;
    if (input.workdir !== undefined) patch.workdir = input.workdir ?? undefined;
    if (input.skills !== undefined) patch.skills = input.skills;
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
      const scriptResult = fresh.script ? await this.runScript(fresh) : null;
      if (scriptResult && !scriptResult.ok) {
        throw new Error(scriptResult.error ?? scriptResult.stderr ?? "scheduled script failed");
      }
      const scriptOutput = scriptResult?.stdout.trim() ?? "";
      const result = fresh.noAgent
        ? {
            status: "complete" as const,
            response: scriptOutput,
            taskIds: [] as string[],
          }
        : await this.powerhouse.executeStimulus({
            stimulus: this.assembleStimulus(fresh, scriptOutput),
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
        lastOutput: result.response,
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
          noAgent: Boolean(fresh.noAgent),
          script: fresh.script ? basename(fresh.script) : null,
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
        lastOutput: undefined,
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

  private assembleStimulus(job: ScheduledJob, scriptOutput: string): string {
    const skillHint = job.skills?.length
      ? `Use these Hermes skills if relevant: ${job.skills.join(", ")}.\n\n`
      : "";
    if (!scriptOutput) return `${skillHint}${job.stimulus}`;
    return [
      `${skillHint}${job.stimulus}`,
      "Scheduled script output:",
      scriptOutput,
    ].join("\n\n");
  }

  private runScript(job: ScheduledJob): Promise<ScriptRunResult> {
    if (!job.script) {
      return Promise.resolve({ ok: true, stdout: "", stderr: "", exitCode: 0 });
    }
    const scriptPath = this.resolveScriptPath(job.script, job.workdir);
    const ext = extname(scriptPath).toLowerCase();
    const command = ext === ".js" || ext === ".mjs"
      ? process.execPath
      : ext === ".sh" || ext === ".bash"
        ? "bash"
        : "python";
    const args = [scriptPath];

    return new Promise((resolveResult) => {
      const child = spawn(command, args, {
        cwd: job.workdir && isAbsolute(job.workdir) ? job.workdir : PATHS.projectRoot,
        env: {
          ...process.env,
          AGENTIX_CRON_JOB_ID: job.id,
          AGENTIX_CRON_JOB_NAME: job.name,
        },
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill();
      }, 60_000);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf-8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf-8");
      });
      child.on("error", (err) => {
        clearTimeout(timeout);
        resolveResult({
          ok: false,
          stdout,
          stderr,
          exitCode: null,
          error: err.message,
        });
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolveResult({
          ok: code === 0,
          stdout,
          stderr,
          exitCode: code,
          error: code === 0 ? undefined : stderr.trim() || `script exited with code ${code}`,
        });
      });
    });
  }

  private resolveScriptPath(script: string, workdir?: string): string {
    const baseDir = workdir && isAbsolute(workdir)
      ? workdir
      : join(PATHS.dataDir, "scripts");
    const candidate = isAbsolute(script) ? resolve(script) : resolve(baseDir, script);
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      throw new Error(`scheduled script not found: ${candidate}`);
    }
    return candidate;
  }
}
