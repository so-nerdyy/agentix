import { Powerhouse } from "../powerhouse/Powerhouse.js";
import { SchedulerService } from "../scheduler/SchedulerService.js";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../config/paths.js";
import { loadConfig } from "../config/index.js";
import { randomUUID } from "node:crypto";
import { RuntimeLogStore } from "../logging/RuntimeLogStore.js";

export class LocalAgentixRuntime {
  private readonly powerhouse = new Powerhouse();
  private readonly scheduler = new SchedulerService(this.powerhouse);
  private readonly runtimeLogs = new RuntimeLogStore();

  constructor() {
    this.scheduler.start();
  }

  listSessions(): Array<{ id: string; createdAt: string }> {
    this.powerhouse.start();
    return this.powerhouse.listSessions().map((session) => ({
      id: session.id,
      createdAt: new Date(session.createdAt).toISOString(),
    }));
  }

  createSession(opts?: { model?: string }): { id: string } {
    const session = this.powerhouse.createSession({
      model: opts?.model ?? null,
      source: "agentix-runtime",
    });
    return { id: session.id };
  }

  deleteSession(id: string): void {
    this.powerhouse.closeSession(id);
  }

  memorySearch(query: string): Array<{ content: string; score: number }> {
    return this.powerhouse.memory.search(query);
  }

  consolidateMemory(sessionId?: string): Record<string, unknown> {
    return { ...this.powerhouse.memory.consolidate(sessionId) };
  }

  listTools(): Array<{ name: string; description: string }> {
    this.powerhouse.start();
    return this.powerhouse.agents.list().map((agent) => ({
      name: agent.kind,
      description: `Pi agent ${agent.id} handles ${agent.kind} tasks.`,
    }));
  }

  listTasks(sessionId?: string): Array<Record<string, unknown>> {
    return this.powerhouse.listTasks(sessionId).map((task) => ({
      id: task.id,
      sessionId: task.sessionId,
      kind: task.kind,
      status: task.status,
      requiresApproval: task.requiresApproval,
      createdAt: new Date(task.createdAt).toISOString(),
      startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
      finishedAt: task.finishedAt ? new Date(task.finishedAt).toISOString() : null,
      error: task.error ?? null,
    }));
  }

  listApprovals(): Array<Record<string, unknown>> {
    return this.powerhouse.listApprovals().map((task) => ({
      id: task.id,
      sessionId: task.sessionId,
      kind: task.kind,
      payload: task.payload,
      createdAt: new Date(task.createdAt).toISOString(),
    }));
  }

  listAudit(): Array<Record<string, unknown>> {
    return this.powerhouse.audit.list().map((entry) => ({ ...entry }));
  }

  listLogs(limit = 100): Array<Record<string, unknown>> {
    return this.runtimeLogs.list(limit).map((entry) => ({ ...entry }));
  }

  healingStats(): Record<string, unknown> {
    return {
      failures: this.powerhouse.healing.list(),
      procedures: this.powerhouse.healing.listProcedures(),
    };
  }

  promoteHealingProcedure(id: string): Record<string, unknown> {
    const procedure = this.powerhouse.healing.promoteProcedure(id);
    return { ok: Boolean(procedure), procedure };
  }

  deprecateHealingProcedure(id: string): Record<string, unknown> {
    const procedure = this.powerhouse.healing.deprecateProcedure(id);
    return { ok: Boolean(procedure), procedure };
  }

  listJobs(): Array<Record<string, unknown>> {
    return this.scheduler.list().map((job) => ({ ...job }));
  }

  createJob(input: {
    name: string;
    stimulus: string;
    intervalMs: number;
    enabled?: boolean;
  }): Record<string, unknown> {
    return this.scheduler.create(input) as unknown as Record<string, unknown>;
  }

  setJobEnabled(id: string, enabled: boolean): Record<string, unknown> {
    const job = this.scheduler.setEnabled(id, enabled);
    return { ok: Boolean(job), job };
  }

  removeJob(id: string): Record<string, unknown> {
    return { ok: this.scheduler.remove(id) };
  }

  async runJob(id: string): Promise<Record<string, unknown>> {
    return this.scheduler.runNow(id) as unknown as Record<string, unknown>;
  }

  createSupportBundle(): Record<string, unknown> {
    this.powerhouse.start();
    const bundleId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const bundleDir = join(PATHS.dataDir, "support", `bundle-${bundleId}`);
    mkdirSync(bundleDir, { recursive: true });

    const writeJson = (name: string, value: unknown): string => {
      const file = join(bundleDir, name);
      writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
      return file;
    };

    const config = loadConfig();
    const safeConfig = {
      ...config,
      llmApiKey: config.llmApiKey ? "[redacted]" : null,
    };

    const sessions = this.listSessions();
    const tasks = this.listTasks();
    const approvals = this.listApprovals();
    const jobs = this.listJobs();
    const audit = this.listAudit();
    const healing = this.healingStats();
    const memory = this.powerhouse.memory.list().slice(-250);

    writeJson("manifest.json", {
      createdAt: new Date().toISOString(),
      bundleId,
      version: "2.1.0",
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      projectRoot: PATHS.projectRoot,
      dataDir: PATHS.dataDir,
      counts: {
        sessions: sessions.length,
        tasks: tasks.length,
        approvals: approvals.length,
        jobs: jobs.length,
        audit: audit.length,
        memory: memory.length,
        healingFailures: Array.isArray((healing as { failures?: unknown[] }).failures)
          ? ((healing as { failures?: unknown[] }).failures?.length ?? 0)
          : 0,
        healingProcedures: Array.isArray((healing as { procedures?: unknown[] }).procedures)
          ? ((healing as { procedures?: unknown[] }).procedures?.length ?? 0)
          : 0,
      },
    });
    writeJson("config.json", safeConfig);
    writeJson("sessions.json", sessions);
    writeJson("tasks.json", tasks);
    writeJson("approvals.json", approvals);
    writeJson("jobs.json", jobs);
    writeJson("audit.json", audit);
    writeJson("healing.json", healing);
    writeJson("memory.json", memory);
    this.copyDirectory(PATHS.logsDir, join(bundleDir, "logs"));

    return {
      ok: true,
      bundleDir,
      files: [
        "manifest.json",
        "config.json",
        "sessions.json",
        "tasks.json",
        "approvals.json",
        "jobs.json",
        "audit.json",
        "healing.json",
        "memory.json",
        "logs/",
      ],
    };
  }

  async approve(taskId: string): Promise<Record<string, unknown>> {
    const result = await this.powerhouse.approve(taskId);
    return {
      ok: result.ok,
      output: result.output,
      error: result.error,
    };
  }

  reject(taskId: string, reason?: string): Record<string, unknown> {
    return { ok: this.powerhouse.reject(taskId, reason) };
  }

  async execute(
    opts: {
      stimulus: string;
      sessionId?: string;
      onDelta?: (delta: string) => void;
    },
  ): Promise<{ response: string; sessionId: string; status: string; taskIds: string[] }> {
    const result = await this.powerhouse.executeStimulus(opts);
    return {
      response: result.response,
      sessionId: result.sessionId,
      status: result.status,
      taskIds: result.taskIds,
    };
  }

  shutdown(): void {
    this.scheduler.stop();
    this.powerhouse.stop();
  }

  private copyDirectory(sourceDir: string, targetDir: string): void {
    if (!existsSync(sourceDir)) return;
    mkdirSync(targetDir, { recursive: true });
    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = join(sourceDir, entry.name);
      const targetPath = join(targetDir, entry.name);
      if (entry.isDirectory()) {
        this.copyDirectory(sourcePath, targetPath);
      } else if (entry.isFile()) {
        copyFileSync(sourcePath, targetPath);
      }
    }
  }
}
