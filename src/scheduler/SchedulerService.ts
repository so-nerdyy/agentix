import { AuditLog } from "../audit/AuditLog.js";
import type { Powerhouse } from "../powerhouse/Powerhouse.js";
import { computeNextRun, parseScheduleInput } from "./CronSchedule.js";
import { ScheduledJobStore, type ScheduledJob } from "./ScheduledJobStore.js";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { PATHS } from "../config/paths.js";
import { OutputBuffer, resolveOutputLimit } from "../pi/OutputBuffer.js";
import { terminateProcessTree, USE_DETACHED_PROCESS_GROUP } from "../pi/processControl.js";

interface ScriptRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
  truncated?: boolean;
}

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private runningDue = false;

  constructor(
    private readonly powerhouse: Powerhouse,
    readonly jobs = new ScheduledJobStore(),
    private readonly audit = new AuditLog(),
    private readonly scriptBaseDirs = defaultScriptBaseDirs(),
    private readonly processOptions: { scriptTimeoutMs?: number; maxOutputBytes?: number } = {},
  ) {
    this.recoverStaleLocks();
  }

  start(intervalMs = 30_000, initialDelayMs = 90_000): void {
    this.stop();
    const run = () => {
      if (this.runningDue) return;
      this.runningDue = true;
      this.runDue().catch((err) => {
        this.audit.record({
          type: "scheduler.error",
          actor: "scheduler",
          data: { error: err instanceof Error ? err.message : String(err) },
        });
      }).finally(() => {
        this.runningDue = false;
      });
    };
    const timer = setTimeout(() => {
      run();
      const interval = setInterval(run, intervalMs);
      interval.unref?.();
      this.timer = interval;
    }, initialDelayMs);
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
      const scriptOutput = scriptResult
        ? [scriptResult.stdout.trim(), scriptResult.truncated ? "[output truncated]" : ""]
            .filter(Boolean)
            .join("\n")
        : "";
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
      const succeeded = result.status === "complete";
      const completedJob = this.jobs.update(job.id, {
        running: false,
        lastRunAt: completedAt,
        nextRunAt,
        enabled: nextRunAt === null ? false : fresh.enabled,
        runCount: fresh.runCount + 1,
        lastStatus: succeeded ? "success" : "failure",
        lastError: succeeded ? undefined : result.response,
        lastOutput: result.response,
        lastTaskIds: result.taskIds,
      });
      this.audit.record({
        type: succeeded ? "scheduler.job_completed" : "scheduler.job_failed",
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
      return { ok: succeeded, error: succeeded ? undefined : result.response };
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
      ? `Use these Agentix skills if relevant: ${job.skills.join(", ")}.\n\n`
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
    const scriptPath = this.resolveScriptPath(job.script);
    const ext = extname(scriptPath).toLowerCase();
    const command = ext === ".js" || ext === ".mjs"
      ? process.execPath
      : ext === ".sh" || ext === ".bash"
        ? "bash"
        : "python";
    const args = [scriptPath];

    return new Promise((resolveResult) => {
      const child = spawn(command, args, {
        cwd: this.resolveWorkdir(job.workdir),
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? process.env.USERPROFILE ?? "",
          USERPROFILE: process.env.USERPROFILE ?? process.env.HOME ?? "",
          TMP: process.env.TMP ?? process.env.TEMP ?? "",
          TEMP: process.env.TEMP ?? process.env.TMP ?? "",
          AGENTIX_CRON_JOB_ID: job.id,
          AGENTIX_CRON_JOB_NAME: job.name,
          AGENTIX_CRON_SCRIPT: "1",
        },
        windowsHide: true,
        detached: USE_DETACHED_PROCESS_GROUP,
      });
      const outputLimit = resolveOutputLimit(this.processOptions.maxOutputBytes);
      const stdout = new OutputBuffer(outputLimit);
      const stderr = new OutputBuffer(outputLimit);
      const configuredTimeout = Number(
        this.processOptions.scriptTimeoutMs ?? process.env.AGENTIX_SCHEDULER_SCRIPT_TIMEOUT_MS,
      );
      const timeoutMs = Number.isFinite(configuredTimeout)
        ? Math.min(10 * 60_000, Math.max(100, configuredTimeout))
        : 60_000;
      let timedOut = false;
      let settled = false;
      const finish = (result: ScriptRunResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolveResult(result);
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child);
      }, timeoutMs);
      timeout.unref?.();

      child.stdout.on("data", (chunk) => {
        stdout.append(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr.append(chunk);
      });
      child.on("error", (err) => {
        finish({
          ok: false,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: null,
          error: err.message,
          truncated: stdout.truncated || stderr.truncated,
        });
      });
      child.on("close", (code) => {
        const stdoutText = stdout.toString();
        const stderrText = stderr.toString();
        finish({
          ok: !timedOut && code === 0,
          stdout: stdoutText,
          stderr: stderrText,
          exitCode: code,
          truncated: stdout.truncated || stderr.truncated,
          error: timedOut
            ? `scheduled script timed out after ${timeoutMs}ms`
            : code === 0
              ? undefined
              : stderrText.trim() || `script exited with code ${code}`,
        });
      });
    });
  }

  private recoverStaleLocks(): void {
    for (const job of this.jobs.list()) {
      if (!job.running) continue;
      this.jobs.update(job.id, { running: false });
      this.audit.record({
        type: "scheduler.job_recovered",
        actor: "system",
        subjectId: job.id,
        data: { reason: "cleared stale running state after restart" },
      });
    }
  }

  private resolveScriptPath(script: string): string {
    const allowedDirs = this.scriptBaseDirs.map((dir) => resolve(dir));
    const candidates = isAbsolute(script)
      ? [resolve(script)]
      : allowedDirs.map((dir) => resolve(dir, script));

    for (const candidate of candidates) {
      if (!allowedDirs.some((dir) => isWithinDir(dir, candidate))) {
        continue;
      }
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate;
      }
    }

    if (isAbsolute(script)) {
      throw new Error(`scheduled script is outside allowed script directories: ${script}`);
    }
    throw new Error(`scheduled script not found in allowed script directories: ${script}`);
  }

  private resolveWorkdir(workdir?: string): string {
    if (!workdir) return PATHS.projectRoot;
    if (!isAbsolute(workdir)) {
      throw new Error(`scheduled workdir must be absolute: ${workdir}`);
    }
    const resolved = resolve(workdir);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new Error(`scheduled workdir is not a directory: ${workdir}`);
    }
    return resolved;
  }
}

function defaultScriptBaseDirs(): string[] {
  const dirs = [
    join(PATHS.dataDir, "scripts"),
    process.env.AGENTIX_FRONTEND_HOME ? join(process.env.AGENTIX_FRONTEND_HOME, "scripts") : null,
    join(homedir(), ".agentix", "scripts"),
  ].filter((dir): dir is string => Boolean(dir));
  return Array.from(new Set(dirs.map((dir) => resolve(dir))));
}

function isWithinDir(baseDir: string, candidate: string): boolean {
  const rel = relative(resolve(baseDir), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
