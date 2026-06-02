import { Powerhouse } from "../powerhouse/Powerhouse.js";
import { SchedulerService } from "../scheduler/SchedulerService.js";

export class LocalAgentixRuntime {
  private readonly powerhouse = new Powerhouse();
  private readonly scheduler = new SchedulerService(this.powerhouse);

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
}
