import { Powerhouse } from "../powerhouse/Powerhouse.js";
import { SchedulerService } from "../scheduler/SchedulerService.js";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../config/paths.js";
import { EventBus } from "../config/EventBus.js";
import { loadConfig, saveConfig, type AgentixConfig } from "../config/index.js";
import { defaultAuthTokenStore, type AuthRole } from "../config/AuthTokenStore.js";
import { randomUUID } from "node:crypto";
import { RuntimeLogStore } from "../logging/RuntimeLogStore.js";
import type { TaskAction } from "../powerhouse/types.js";
import { GatewayRegistry } from "../gateway/GatewayRegistry.js";
import {
  deliverGatewayResponse,
  gatewaySecretConfigured,
  gatewayTokenConfigured,
  parseGatewayInbound,
  verifyGatewaySecret,
} from "../gateway/GatewayConnector.js";
import type { CommandAgentProfile } from "../pi/AgentProfileStore.js";
import { dockerSandboxAvailable } from "../pi/SandboxAgent.js";
import { PACKAGE_METADATA } from "../config/package.js";

export type RuntimeSearchResults = {
  query: string;
  tasks: Array<{ id: string; sessionId: string; kind: string; status: string; createdAt: string; summary: string }>;
  sessions: Array<{ id: string; status: string; createdAt: string; updatedAt: string; metadata: Record<string, unknown> }>;
  memory: Array<{ id: string; sessionId: string; taskId: string | null; role: string; content: string; createdAt: string; tags: string[] }>;
  audit: Array<{ id: string; type: string; actor: string; subjectId: string | null; createdAt: string; data: Record<string, unknown> }>;
  logs: Array<Record<string, unknown>>;
  jobs: Array<{
    id: string;
    name: string;
    stimulus: string;
    enabled: boolean;
    schedule: string;
    scheduleKind: string;
    scheduleDisplay: string;
    intervalMs: number;
    nextRunAt: string | null;
    lastRunAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
    lastOutput: string | null;
    script: string | null;
    noAgent: boolean;
    workdir: string | null;
    skills: string[];
    runCount: number;
  }>;
  plans: Array<{
    id: string;
    sessionId: string;
    status: string;
    planner: string;
    stimulus: string;
    stepCount: number;
    taskCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
  healing: Array<{ fingerprint: string; count: number; firstSeenAt: string; lastSeenAt: string; lastError: string }>;
  gateways: Array<{ id: string; platform: string; name: string; enabled: boolean; status: string; endpoint: string | null; tokenConfigured: boolean; messageCount: number; lastSeenAt: string | null; lastError: string | null }>;
};

export type RuntimeSessionDetail = {
  session: {
    id: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    metadata: Record<string, unknown>;
  };
  tasks: Array<{
    id: string;
    sessionId: string;
    kind: string;
    status: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
  }>;
  memory: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
};

export type RuntimeToolDetail = {
  tool: {
    id: string;
    kind: string;
    healthy: boolean;
  };
  summary: {
    totalTasks: number;
    recentTasks: Array<{
      id: string;
      sessionId: string;
      kind: string;
      status: string;
      createdAt: string;
      error: string | null;
    }>;
  };
  audit: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
};

export type RuntimeApprovalDetail = {
  approval: {
    id: string;
    sessionId: string;
    kind: string;
    status: string;
    payload: Record<string, unknown>;
    createdAt: string;
  };
  task: RuntimeSessionDetail["tasks"][number] | null;
  session: RuntimeSessionDetail["session"] | null;
  memory: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
};

export type RuntimeHealingDetail = {
  failure: {
    fingerprint: string;
    count: number;
    lastError: string;
    firstSeenAt: string;
    lastSeenAt: string;
  } | null;
  procedure: {
    id: string;
    fingerprint: string;
    status: string;
    summary: string;
    createdAt: string;
    updatedAt: string;
    uses: number;
    successes: number;
    failures: number;
    lastUsedAt: string | null;
    autoPromotedAt: string | null;
    deprecatedReason: string | null;
  } | null;
  relatedTasks: Array<{
    id: string;
    sessionId: string;
    kind: string;
    status: string;
    createdAt: string;
    error: string | null;
  }>;
  audit: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
};

export type RuntimeLogDetail = {
  log: {
    index: number;
    timestamp: string;
    level: "info" | "warn" | "error";
    source: "system" | "user" | "scheduler" | "gateway";
    message: string;
  } | null;
  relatedTasks: Array<{
    id: string;
    sessionId: string;
    kind: string;
    status: string;
    createdAt: string;
    error: string | null;
  }>;
  relatedSessions: Array<{
    id: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    metadata: Record<string, unknown>;
  }>;
  audit: Array<Record<string, unknown>>;
};

export type RuntimeAuditDetail = {
  audit: {
    id: string;
    type: string;
    actor: string;
    subjectId: string | null;
    createdAt: string;
    data: Record<string, unknown>;
  } | null;
  relatedTasks: Array<{
    id: string;
    sessionId: string;
    kind: string;
    status: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
  }>;
  relatedSessions: Array<{
    id: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    metadata: Record<string, unknown>;
  }>;
  logs: Array<Record<string, unknown>>;
};

export type RuntimeGatewayDetail = {
  gateway: {
    id: string;
    platform: string;
    name: string;
    enabled: boolean;
    status: string;
    endpoint: string | null;
    tokenConfigured: boolean;
    inboundSecretConfigured: boolean;
    messageCount: number;
    lastSeenAt: string | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
    metadata: Record<string, unknown>;
  };
  relatedSessions: Array<{
    id: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    metadata: Record<string, unknown>;
  }>;
  relatedTasks: Array<{
    id: string;
    sessionId: string;
    kind: string;
    status: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
  }>;
  audit: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
};

export type RuntimePlanDetail = {
  execution: {
    id: string;
    sessionId: string;
    status: string;
    planner: string;
    reasoning: string | null;
    fallbackReason: string | null;
    stimulus: string;
    stepCount: number;
    taskCount: number;
    createdAt: string;
    updatedAt: string;
  };
  steps: Array<{
    id: string;
    kind: string;
    priority: string;
    dependsOn: string[];
    requiresApproval: boolean;
    maxAttempts: number;
    payload: Record<string, unknown>;
    task: {
      id: string;
      status: string;
      error: string | null;
      result: unknown;
      createdAt: string;
      startedAt: string | null;
      finishedAt: string | null;
    } | null;
  }>;
  tasks: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
};

export class LocalAgentixRuntime {
  private readonly powerhouse = new Powerhouse();
  private readonly scheduler = new SchedulerService(this.powerhouse);
  private readonly runtimeLogs = new RuntimeLogStore();
  private readonly gateways = new GatewayRegistry();

  constructor() {
    this.scheduler.start();
  }

  listSessions(): Array<{
    id: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    metadata: Record<string, unknown>;
  }> {
    this.powerhouse.start();
    return this.powerhouse.listSessions().map((session) => ({
      id: session.id,
      status: session.status,
      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date(session.updatedAt).toISOString(),
      metadata: session.metadata,
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

  renameSession(id: string, title: string): Record<string, unknown> {
    const session = this.powerhouse.renameSession(id, title);
    if (!session) return { ok: false, error: `unknown session: ${id}` };
    return {
      ok: true,
      session: {
        id: session.id,
        status: session.status,
        createdAt: new Date(session.createdAt).toISOString(),
        updatedAt: new Date(session.updatedAt).toISOString(),
        metadata: session.metadata,
      },
    };
  }

  pruneSessions(opts: { olderThanDays?: number; source?: string } = {}): Record<string, unknown> {
    this.powerhouse.start();
    const olderThanDays = Math.max(0, Number(opts.olderThanDays ?? 90));
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const source = opts.source?.trim();
    const pruned: string[] = [];
    for (const session of this.powerhouse.listSessions()) {
      if (session.updatedAt > cutoff) continue;
      if (source && String(session.metadata?.source ?? "") !== source) continue;
      this.powerhouse.closeSession(session.id);
      pruned.push(session.id);
    }
    return { ok: true, count: pruned.length, pruned, olderThanDays, source: source || null };
  }

  optimizeSessions(): Record<string, unknown> {
    this.powerhouse.start();
    const sessions = this.powerhouse.listSessions().length;
    const memory = this.powerhouse.memory.list().length;
    return {
      ok: true,
      sessions,
      memory,
      detail: "Agentix sessions are JSON-backed; no database vacuum is required.",
    };
  }

  memorySearch(query: string): Array<{ content: string; score: number }> {
    return this.powerhouse.memory.search(query);
  }

  listMemory(sessionId?: string): Array<Record<string, unknown>> {
    return this.powerhouse.memory.list(sessionId).map((entry) => ({
      ...entry,
      createdAt: new Date(entry.createdAt).toISOString(),
    }));
  }

  consolidateMemory(sessionId?: string): Record<string, unknown> {
    const entry = this.powerhouse.memory.consolidate(sessionId);
    return {
      ...entry,
      createdAt: new Date(entry.createdAt).toISOString(),
    };
  }

  resetMemory(input: {
    target?: "all" | "memory" | "user";
    sessionId?: string;
  } = {}): Record<string, unknown> {
    const target = input.target ?? "all";
    const roles = target === "user"
      ? ["user" as const]
      : target === "memory"
        ? ["assistant" as const, "system" as const]
        : undefined;
    return {
      ok: true,
      target,
      sessionId: input.sessionId ?? null,
      ...this.powerhouse.memory.reset({ sessionId: input.sessionId, roles }),
    };
  }

  listTools(): Array<{ name: string; description: string }> {
    this.powerhouse.start();
    return this.powerhouse.agents.list().map((agent) => ({
      name: agent.kind,
      description: `Pi agent ${agent.id} handles ${agent.kind} tasks.`,
    }));
  }

  getTool(toolId: string): RuntimeToolDetail | null {
    this.powerhouse.start();
    const tool = this.powerhouse.agents.get(toolId) ?? this.powerhouse.agents.list().find((agent) => agent.kind === toolId);
    if (!tool) return null;
    const relatedTasks = this.powerhouse
      .listTasks()
      .filter((task) => task.kind === tool.kind)
      .slice(-10)
      .map((task) => ({
        id: task.id,
        sessionId: task.sessionId,
        kind: task.kind,
        status: task.status,
        createdAt: new Date(task.createdAt).toISOString(),
        error: task.error ?? null,
      }));
    const audit = this.powerhouse
      .audit
      .list(250)
      .filter((entry) => entry.data?.agentId === tool.id || entry.data?.agentKind === tool.kind || entry.subjectId === tool.id)
      .map((entry) => ({ ...entry }));
    const logs = this.runtimeLogs
      .list(250)
      .filter((entry) => String(entry.message ?? "").includes(tool.id) || String(entry.message ?? "").includes(tool.kind))
      .map((entry) => ({ ...entry }));
    return {
      tool: {
        id: tool.id,
        kind: tool.kind,
        healthy: tool.healthy(),
      },
      summary: {
        totalTasks: this.powerhouse.listTasks().filter((task) => task.kind === tool.kind).length,
        recentTasks: relatedTasks,
      },
      audit,
      logs,
    };
  }

  listAgentProfiles(): Record<string, unknown> {
    return {
      profiles: this.powerhouse.agentProfiles.list(),
      registeredAgents: this.powerhouse.agents.list().map((agent) => ({
        id: agent.id,
        kind: agent.kind,
        healthy: agent.healthy(),
      })),
    };
  }

  upsertAgentProfile(input: Partial<CommandAgentProfile>): Record<string, unknown> {
    const profile = this.powerhouse.agentProfiles.upsert({
      id: String(input.id ?? "").trim(),
      kind: String(input.kind ?? "").trim(),
      description: typeof input.description === "string" ? input.description : undefined,
      enabled: input.enabled !== false,
      command: Array.isArray(input.command) ? input.command.map((part) => String(part)) : [],
      cwd: typeof input.cwd === "string" ? input.cwd : undefined,
      timeoutMs: typeof input.timeoutMs === "number" ? input.timeoutMs : undefined,
    });
    this.powerhouse.audit.record({
      type: "agent.profile_upserted",
      actor: "user",
      subjectId: profile.id,
      data: { kind: profile.kind, enabled: profile.enabled },
    });
    return { ok: true, profile };
  }

  setAgentProfileEnabled(id: string, enabled: boolean): Record<string, unknown> {
    const profile = this.powerhouse.agentProfiles.setEnabled(id, enabled);
    if (profile) {
      this.powerhouse.audit.record({
        type: enabled ? "agent.profile_enabled" : "agent.profile_disabled",
        actor: "user",
        subjectId: id,
        data: { kind: profile.kind },
      });
    }
    return { ok: Boolean(profile), profile };
  }

  search(query: string): RuntimeSearchResults {
    this.powerhouse.start();
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return {
        query,
        tasks: [],
        sessions: [],
        memory: [],
        audit: [],
        logs: [],
        jobs: [],
        plans: [],
        healing: [],
        gateways: [],
      };
    }

    const includes = (value: unknown): boolean => String(value ?? "").toLowerCase().includes(needle);
    const matchesRecord = (value: unknown): boolean => includes(JSON.stringify(value));

    const tasks = this.powerhouse
      .listTasks()
      .filter((task) =>
        matchesRecord({
          id: task.id,
          sessionId: task.sessionId,
          kind: task.kind,
          status: task.status,
          payload: task.payload,
          error: task.error,
        }),
      )
      .map((task) => ({
        id: task.id,
        sessionId: task.sessionId,
        kind: task.kind,
        status: task.status,
        createdAt: new Date(task.createdAt).toISOString(),
        summary: task.error ?? JSON.stringify(task.payload),
      }));

    const sessions = this.powerhouse
      .listSessions()
      .filter((session) => matchesRecord({ id: session.id, status: session.status, metadata: session.metadata }))
      .map((session) => ({
        id: session.id,
        status: session.status,
        createdAt: new Date(session.createdAt).toISOString(),
        updatedAt: new Date(session.updatedAt).toISOString(),
        metadata: session.metadata,
      }));

    const memory = this.powerhouse
      .memory
      .list()
      .filter((record) => matchesRecord(record))
      .map((record) => ({
        id: record.id,
        sessionId: record.sessionId,
        taskId: record.taskId ?? null,
        role: record.role,
        content: record.content,
        createdAt: new Date(record.createdAt).toISOString(),
        tags: record.tags,
      }));

    const audit = this.powerhouse
      .audit
      .list(250)
      .filter((entry) => matchesRecord(entry))
      .map((entry) => ({
        id: entry.id,
        type: entry.type,
        actor: entry.actor,
        subjectId: entry.subjectId ?? null,
        createdAt: new Date(entry.createdAt).toISOString(),
        data: entry.data,
      }));

    const logs = this.runtimeLogs
      .list(250)
      .filter((entry) => matchesRecord(entry))
      .map((entry) => ({ ...entry }));

    const jobs = this.scheduler
      .list()
      .filter((job) => matchesRecord(job))
      .map((job) => ({
        id: job.id,
        name: job.name,
        stimulus: job.stimulus,
        enabled: job.enabled,
        schedule: job.schedule,
        scheduleKind: job.scheduleKind,
        scheduleDisplay: job.scheduleDisplay,
        intervalMs: job.intervalMs,
        nextRunAt: job.nextRunAt ? new Date(job.nextRunAt).toISOString() : null,
        lastRunAt: job.lastRunAt ? new Date(job.lastRunAt).toISOString() : null,
        lastStatus: job.lastStatus ?? null,
        lastError: job.lastError ?? null,
        lastOutput: job.lastOutput ?? null,
        script: job.script ?? null,
        noAgent: Boolean(job.noAgent),
        workdir: job.workdir ?? null,
        skills: job.skills ?? [],
        runCount: job.runCount,
      }));

    const plans = this.powerhouse
      .planStore
      .list()
      .filter((execution) => matchesRecord(execution))
      .map((execution) => ({
        id: execution.plan.id,
        sessionId: execution.sessionId,
        status: execution.status,
        planner: execution.plan.planner,
        stimulus: execution.plan.stimulus,
        stepCount: execution.plan.steps.length,
        taskCount: execution.taskIds.length,
        createdAt: new Date(execution.createdAt).toISOString(),
        updatedAt: new Date(execution.updatedAt).toISOString(),
      }));

    const healing = this.powerhouse
      .healing
      .list()
      .filter((item) => matchesRecord(item))
      .map((item) => ({
        fingerprint: item.fingerprint,
        count: item.count,
        firstSeenAt: new Date(item.firstSeenAt).toISOString(),
        lastSeenAt: new Date(item.lastSeenAt).toISOString(),
        lastError: item.lastError,
      }));

    const gateways = this.gateways
      .list()
      .filter((gateway) => matchesRecord(gateway))
      .map((gateway) => ({
        id: gateway.id,
        platform: gateway.platform,
        name: gateway.name,
        enabled: gateway.enabled,
        status: gateway.status,
        endpoint: gateway.endpoint,
        tokenConfigured: gateway.tokenConfigured,
        messageCount: gateway.messageCount,
        lastSeenAt: gateway.lastSeenAt ? new Date(gateway.lastSeenAt).toISOString() : null,
        lastError: gateway.lastError,
      }));

    return {
      query,
      tasks,
      sessions,
      memory,
      audit,
      logs,
      jobs,
      plans,
      healing,
      gateways,
    };
  }

  listTasks(sessionId?: string): Array<Record<string, unknown>> {
    return this.powerhouse.listTasks(sessionId).map((task) => ({
      id: task.id,
      sessionId: task.sessionId,
      kind: task.kind,
      planId: task.planId ?? null,
      stepId: task.stepId ?? null,
      status: task.status,
      requiresApproval: task.requiresApproval,
      createdAt: new Date(task.createdAt).toISOString(),
      startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
      finishedAt: task.finishedAt ? new Date(task.finishedAt).toISOString() : null,
      error: task.error ?? null,
    }));
  }

  listPlans(): Array<Record<string, unknown>> {
    return this.powerhouse.planStore.list().map((execution) => {
      const tasks = this.powerhouse.listTasks().filter((task) => task.planId === execution.plan.id);
      return {
        id: execution.plan.id,
        sessionId: execution.sessionId,
        status: execution.status,
        planner: execution.plan.planner,
        reasoning: execution.plan.reasoning ?? null,
        fallbackReason: execution.plan.fallbackReason ?? null,
        stimulus: execution.plan.stimulus,
        stepCount: execution.plan.steps.length,
        taskCount: execution.taskIds.length,
        completedSteps: tasks.filter((task) => task.status === "complete").length,
        awaitingApprovals: tasks.filter((task) => task.status === "awaiting-approval").length,
        failedTasks: tasks.filter((task) => task.status === "failed").length,
        createdAt: new Date(execution.createdAt).toISOString(),
        updatedAt: new Date(execution.updatedAt).toISOString(),
      };
    });
  }

  getPlan(planId: string): RuntimePlanDetail | null {
    this.powerhouse.start();
    const execution = this.powerhouse.planStore.get(planId);
    if (!execution) return null;
    const tasks = this.powerhouse
      .listTasks()
      .filter((task) => task.planId === planId);
    const taskByStep = new Map(tasks.filter((task) => task.stepId).map((task) => [task.stepId!, task]));
    const normalizedTasks = tasks.map((task) => ({
      ...task,
      createdAt: new Date(task.createdAt).toISOString(),
      startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
      finishedAt: task.finishedAt ? new Date(task.finishedAt).toISOString() : null,
      error: task.error ?? null,
    }));
    const audit = this.powerhouse
      .audit
      .list(250)
      .filter((entry) =>
        entry.subjectId === planId ||
        entry.data?.planId === planId ||
        tasks.some((task) => task.id === entry.subjectId),
      )
      .map((entry) => ({ ...entry }));
    const logs = this.runtimeLogs
      .list(250)
      .filter((entry) =>
        String(entry.message ?? "").includes(planId) ||
        tasks.some((task) => String(entry.message ?? "").includes(task.id)),
      )
      .map((entry) => ({ ...entry }));

    return {
      execution: {
        id: execution.plan.id,
        sessionId: execution.sessionId,
        status: execution.status,
        planner: execution.plan.planner,
        reasoning: execution.plan.reasoning ?? null,
        fallbackReason: execution.plan.fallbackReason ?? null,
        stimulus: execution.plan.stimulus,
        stepCount: execution.plan.steps.length,
        taskCount: execution.taskIds.length,
        createdAt: new Date(execution.createdAt).toISOString(),
        updatedAt: new Date(execution.updatedAt).toISOString(),
      },
      steps: execution.plan.steps.map((step) => {
        const task = taskByStep.get(step.id);
        return {
          id: step.id,
          kind: step.kind,
          priority: step.priority,
          dependsOn: step.dependsOn,
          requiresApproval: step.requiresApproval,
          maxAttempts: step.maxAttempts,
          payload: step.payload,
          task: task
            ? {
                id: task.id,
                status: task.status,
                error: task.error ?? null,
                result: task.result,
                createdAt: new Date(task.createdAt).toISOString(),
                startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
                finishedAt: task.finishedAt ? new Date(task.finishedAt).toISOString() : null,
              }
            : null,
        };
      }),
      tasks: normalizedTasks,
      audit,
      logs,
    };
  }

  async controlPlan(planId: string, action: "replay" | "cancel" | "retry-failed"): Promise<Record<string, unknown>> {
    this.powerhouse.start();
    const execution = this.powerhouse.planStore.get(planId);
    if (!execution) return { ok: false, error: `unknown plan: ${planId}` };

    const tasks = this.powerhouse
      .listTasks(execution.sessionId)
      .filter((task) => task.planId === planId);

    if (action === "replay") {
      const result = await this.execute({
        stimulus: execution.plan.stimulus,
        sessionId: execution.sessionId,
      });
      this.powerhouse.audit.record({
        type: "plan.replayed",
        actor: "user",
        subjectId: planId,
        data: {
          sessionId: execution.sessionId,
          replayTaskIds: result.taskIds,
          replayStatus: result.status,
        },
      });
      return { ok: result.status !== "failed", action, sourcePlanId: planId, result };
    }

    if (action === "cancel") {
      const cancellable = tasks.filter((task) =>
        ["queued", "running", "awaiting-approval"].includes(task.status),
      );
      const results: Array<Record<string, unknown> & { ok?: unknown; taskId: string }> = [];
      for (const task of cancellable) {
        results.push({ taskId: task.id, ...(await this.controlTask(task.id, "cancel")) });
      }
      this.powerhouse.audit.record({
        type: "plan.cancelled",
        actor: "user",
        subjectId: planId,
        data: { sessionId: execution.sessionId, taskIds: cancellable.map((task) => task.id) },
      });
      return { ok: results.every((item) => item.ok), action, planId, count: results.length, results };
    }

    if (action === "retry-failed") {
      const retryable = tasks.filter((task) => ["failed", "rejected"].includes(task.status));
      const results: Array<Record<string, unknown> & { ok?: unknown; taskId: string }> = [];
      for (const task of retryable) {
        results.push({ taskId: task.id, ...(await this.controlTask(task.id, "retry")) });
      }
      this.powerhouse.audit.record({
        type: "plan.retry_failed",
        actor: "user",
        subjectId: planId,
        data: { sessionId: execution.sessionId, taskIds: retryable.map((task) => task.id) },
      });
      return { ok: results.every((item) => item.ok), action, planId, count: results.length, results };
    }

    return { ok: false, error: `unsupported plan action: ${action}` };
  }

  getSession(sessionId: string): RuntimeSessionDetail | null {
    this.powerhouse.start();
    const session = this.powerhouse.listSessions().find((item) => item.id === sessionId);
    if (!session) return null;
    const tasks = this.powerhouse.listTasks(sessionId).map((task) => ({
      id: task.id,
      sessionId: task.sessionId,
      kind: task.kind,
      status: task.status,
      createdAt: new Date(task.createdAt).toISOString(),
      startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
      finishedAt: task.finishedAt ? new Date(task.finishedAt).toISOString() : null,
      error: task.error ?? null,
    }));
    const memory = this.powerhouse.memory.list(sessionId).map((entry) => ({ ...entry }));
    const audit = this.powerhouse
      .audit
      .list(250)
      .filter((entry) => entry.data?.sessionId === sessionId || entry.subjectId === sessionId || tasks.some((task) => task.id === entry.subjectId))
      .map((entry) => ({ ...entry }));
    const logs = this.runtimeLogs
      .list(250)
      .filter((entry) => String(entry.message ?? "").includes(sessionId))
      .map((entry) => ({ ...entry }));
    return {
      session: {
        id: session.id,
        status: session.status,
        createdAt: new Date(session.createdAt).toISOString(),
        updatedAt: new Date(session.updatedAt).toISOString(),
        metadata: session.metadata,
      },
      tasks,
      memory,
      audit,
      logs,
    };
  }

  getTask(taskId: string): Record<string, unknown> | null {
    this.powerhouse.start();
    const task = this.powerhouse.listTasks().find((item) => item.id === taskId);
    if (!task) return null;
    const session = this.powerhouse
      .listSessions()
      .find((item) => item.id === task.sessionId) ?? null;
    const memory = this.powerhouse
      .memory
      .list(task.sessionId)
      .filter((entry) => entry.taskId === task.id || entry.tags.includes(task.kind) || entry.tags.includes("stimulus"))
      .map((entry) => ({ ...entry }));
    const audit = this.powerhouse
      .audit
      .list(250)
      .filter((entry) => entry.subjectId === task.id || entry.data?.sessionId === task.sessionId)
      .map((entry) => ({ ...entry }));
    const logs = this.runtimeLogs
      .list(250)
      .filter((entry) =>
        String(entry.message ?? "").includes(task.id) ||
        String(entry.message ?? "").includes(task.sessionId),
      )
      .map((entry) => ({ ...entry }));
    return {
      task: {
        ...task,
        createdAt: new Date(task.createdAt).toISOString(),
        startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
        finishedAt: task.finishedAt ? new Date(task.finishedAt).toISOString() : null,
      },
      session: session
        ? {
            ...session,
            createdAt: new Date(session.createdAt).toISOString(),
            updatedAt: new Date(session.updatedAt).toISOString(),
          }
        : null,
      memory,
      audit,
      logs,
    };
  }

  async controlTask(taskId: string, action: TaskAction): Promise<Record<string, unknown>> {
    const result = await this.powerhouse.controlTask(taskId, action);
    return {
      ok: result.ok,
      output: result.output ?? null,
      error: result.error ?? null,
    };
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

  getApproval(taskId: string): RuntimeApprovalDetail | null {
    this.powerhouse.start();
    const approval = this.powerhouse.listApprovals().find((task) => task.id === taskId);
    if (!approval) return null;
    const task = this.powerhouse.listTasks().find((item) => item.id === taskId) ?? null;
    const session = this.powerhouse.listSessions().find((item) => item.id === approval.sessionId) ?? null;
    const memory = this.powerhouse
      .memory
      .list(approval.sessionId)
      .filter((entry) => entry.taskId === approval.id || entry.tags.includes(approval.kind) || entry.tags.includes("stimulus"))
      .map((entry) => ({ ...entry }));
    const audit = this.powerhouse
      .audit
      .list(250)
      .filter((entry) => entry.subjectId === approval.id || entry.data?.sessionId === approval.sessionId)
      .map((entry) => ({ ...entry }));
    const logs = this.runtimeLogs
      .list(250)
      .filter((entry) =>
        String(entry.message ?? "").includes(approval.id) ||
        String(entry.message ?? "").includes(approval.sessionId),
      )
      .map((entry) => ({ ...entry }));
    return {
      approval: {
        id: approval.id,
        sessionId: approval.sessionId,
        kind: approval.kind,
        status: approval.status,
        payload: approval.payload,
        createdAt: new Date(approval.createdAt).toISOString(),
      },
      task: task
        ? {
            id: task.id,
            sessionId: task.sessionId,
            kind: task.kind,
            status: task.status,
            createdAt: new Date(task.createdAt).toISOString(),
            startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
            finishedAt: task.finishedAt ? new Date(task.finishedAt).toISOString() : null,
            error: task.error ?? null,
          }
        : null,
      session: session
        ? {
            id: session.id,
            status: session.status,
            createdAt: new Date(session.createdAt).toISOString(),
            updatedAt: new Date(session.updatedAt).toISOString(),
            metadata: session.metadata,
          }
        : null,
      memory,
      audit,
      logs,
    };
  }

  listAudit(): Array<Record<string, unknown>> {
    return this.powerhouse.audit.list().map((entry) => ({ ...entry }));
  }

  getAudit(id: string): RuntimeAuditDetail | null {
    this.powerhouse.start();
    const audit = this.powerhouse.audit.list(500).find((entry) => entry.id === id) ?? null;
    if (!audit) return null;
    const relatedTasks = this.powerhouse
      .listTasks()
      .filter((task) => task.id === audit.subjectId || task.sessionId === audit.data?.sessionId)
      .map((task) => ({
        id: task.id,
        sessionId: task.sessionId,
        kind: task.kind,
        status: task.status,
        createdAt: new Date(task.createdAt).toISOString(),
        startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
        finishedAt: task.finishedAt ? new Date(task.finishedAt).toISOString() : null,
        error: task.error ?? null,
      }));
    const relatedSessions = this.powerhouse
      .listSessions()
      .filter((session) => session.id === audit.subjectId || session.id === audit.data?.sessionId || relatedTasks.some((task) => task.sessionId === session.id))
      .map((session) => ({
        id: session.id,
        status: session.status,
        createdAt: new Date(session.createdAt).toISOString(),
        updatedAt: new Date(session.updatedAt).toISOString(),
        metadata: session.metadata,
      }));
    const logs = this.runtimeLogs
      .list(250)
      .filter((entry) => String(entry.message ?? "").includes(audit.id) || String(entry.message ?? "").includes(audit.type))
      .map((entry) => ({ ...entry }));
    return {
      audit: {
        id: audit.id,
        type: audit.type,
        actor: audit.actor,
        subjectId: audit.subjectId ?? null,
        createdAt: new Date(audit.createdAt).toISOString(),
        data: audit.data,
      },
      relatedTasks,
      relatedSessions,
      logs,
    };
  }

  listLogs(limit = 100): Array<Record<string, unknown>> {
    return this.runtimeLogs.list(limit).map((entry) => ({ ...entry }));
  }

  getLog(index: number): RuntimeLogDetail | null {
    this.powerhouse.start();
    const logs = this.runtimeLogs.list(500);
    if (!Number.isInteger(index) || index < 0 || index >= logs.length) return null;
    const log = logs[index] ?? null;
    if (!log) return null;
    const message = String(log.message ?? "");
    const relatedTasks = this.powerhouse
      .listTasks()
      .filter((task) =>
        message.includes(task.id) ||
        message.includes(task.sessionId) ||
        message.includes(task.kind),
      )
      .slice(-10)
      .map((task) => ({
        id: task.id,
        sessionId: task.sessionId,
        kind: task.kind,
        status: task.status,
        createdAt: new Date(task.createdAt).toISOString(),
        error: task.error ?? null,
      }));
    const sessionIds = new Set(relatedTasks.map((task) => task.sessionId));
    const relatedSessions = this.powerhouse
      .listSessions()
      .filter((session) => sessionIds.has(session.id) || message.includes(session.id))
      .map((session) => ({
        id: session.id,
        status: session.status,
        createdAt: new Date(session.createdAt).toISOString(),
        updatedAt: new Date(session.updatedAt).toISOString(),
        metadata: session.metadata,
      }));
    const audit = this.powerhouse
      .audit
      .list(250)
      .filter((entry) =>
        message.includes(entry.id) ||
        message.includes(entry.subjectId ?? "") ||
        message.includes(String(entry.type ?? "")),
      )
      .map((entry) => ({ ...entry }));
    return {
      log: {
        index,
        timestamp: log.timestamp,
        level: log.level,
        source: log.source,
        message: log.message,
      },
      relatedTasks,
      relatedSessions,
      audit,
    };
  }

  healingStats(): Record<string, unknown> {
    return {
      failures: this.powerhouse.healing.list(),
      procedures: this.powerhouse.healing.listProcedures(),
    };
  }

  listGateways(): Array<Record<string, unknown>> {
    return this.gateways.list().map((gateway) => ({
      ...gateway,
      tokenConfigured: gateway.tokenConfigured || gatewayTokenConfigured(gateway),
      inboundSecretConfigured: gatewaySecretConfigured(gateway.id),
      createdAt: new Date(gateway.createdAt).toISOString(),
      updatedAt: new Date(gateway.updatedAt).toISOString(),
      lastSeenAt: gateway.lastSeenAt ? new Date(gateway.lastSeenAt).toISOString() : null,
    }));
  }

  getGateway(id: string): RuntimeGatewayDetail | null {
    this.powerhouse.start();
    const gateway = this.gateways.get(id);
    if (!gateway) return null;
    const relatedSessions = this.powerhouse
      .listSessions()
      .filter((session) => String(session.metadata?.gatewayId ?? "") === gateway.id || String(session.metadata?.gatewayPlatform ?? "") === gateway.platform)
      .map((session) => ({
        id: session.id,
        status: session.status,
        createdAt: new Date(session.createdAt).toISOString(),
        updatedAt: new Date(session.updatedAt).toISOString(),
        metadata: session.metadata,
      }));
    const sessionIds = new Set(relatedSessions.map((session) => session.id));
    const relatedTasks = this.powerhouse
      .listTasks()
      .filter((task) => sessionIds.has(task.sessionId) || String(task.payload?.gatewayId ?? "") === gateway.id || String(task.payload?.gatewayPlatform ?? "") === gateway.platform)
      .map((task) => ({
        id: task.id,
        sessionId: task.sessionId,
        kind: task.kind,
        status: task.status,
        createdAt: new Date(task.createdAt).toISOString(),
        startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
        finishedAt: task.finishedAt ? new Date(task.finishedAt).toISOString() : null,
        error: task.error ?? null,
      }));
    const audit = this.powerhouse
      .audit
      .list(250)
      .filter((entry) => entry.subjectId === gateway.id || entry.data?.gatewayId === gateway.id || entry.data?.gatewayPlatform === gateway.platform)
      .map((entry) => ({ ...entry }));
    const logs = this.runtimeLogs
      .list(250)
      .filter((entry) => String(entry.message ?? "").includes(gateway.id) || String(entry.message ?? "").includes(gateway.platform))
      .map((entry) => ({ ...entry }));
    return {
      gateway: {
        id: gateway.id,
        platform: gateway.platform,
        name: gateway.name,
        enabled: gateway.enabled,
        status: gateway.status,
        endpoint: gateway.endpoint,
        tokenConfigured: gateway.tokenConfigured || gatewayTokenConfigured(gateway),
        inboundSecretConfigured: gatewaySecretConfigured(gateway.id),
        messageCount: gateway.messageCount,
        lastSeenAt: gateway.lastSeenAt ? new Date(gateway.lastSeenAt).toISOString() : null,
        lastError: gateway.lastError,
        createdAt: new Date(gateway.createdAt).toISOString(),
        updatedAt: new Date(gateway.updatedAt).toISOString(),
        metadata: gateway.metadata,
      },
      relatedSessions,
      relatedTasks,
      audit,
      logs,
    };
  }

  setGatewayEnabled(id: string, enabled: boolean): Record<string, unknown> {
    const gateway = this.gateways.setEnabled(id, enabled);
    this.powerhouse.audit.record({
      type: enabled ? "gateway.enabled" : "gateway.disabled",
      actor: "system",
      subjectId: gateway.id,
      data: { gatewayId: gateway.id, gatewayPlatform: gateway.platform, enabled },
    });
    EventBus.emit(enabled ? "gateway:enabled" : "gateway:disabled", {
      gatewayId: gateway.id,
      gatewayPlatform: gateway.platform,
      enabled,
    });
    return { ok: true, gateway };
  }

  async receiveGatewayMessage(input: {
    gatewayId: string;
    stimulus: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
    deliver?: boolean;
  }): Promise<Record<string, unknown>> {
    this.powerhouse.start();
    const gateway = this.gateways.get(input.gatewayId);
    if (!gateway) {
      throw new Error(`unknown gateway: ${input.gatewayId}`);
    }
    this.gateways.recordMessage(gateway.id, { status: "connected" });
    const session = this.powerhouse.createSession({
      source: "gateway",
      gatewayId: gateway.id,
      gatewayPlatform: gateway.platform,
      gatewayName: gateway.name,
      ...(input.metadata ?? {}),
    });
    const result = await this.powerhouse.executeStimulus({
      stimulus: input.stimulus,
      sessionId: input.sessionId ?? session.id,
      onDelta: undefined,
    });
    const delivery = input.deliver === false
      ? { attempted: false, ok: false, target: null, error: "delivery disabled" }
      : await deliverGatewayResponse(gateway, result.response, input.metadata);
    if (delivery.attempted) {
      this.gateways.touch(gateway.id, {
        status: delivery.ok ? "connected" : "error",
        lastSeenAt: Date.now(),
        lastError: delivery.ok ? null : delivery.error ?? "gateway delivery failed",
      });
    }
    this.powerhouse.audit.record({
      type: "gateway.message.received",
      actor: "gateway",
      subjectId: gateway.id,
      data: {
        gatewayId: gateway.id,
        gatewayPlatform: gateway.platform,
        sessionId: result.sessionId,
        taskIds: result.taskIds,
        delivery,
      },
    });
    EventBus.emit("gateway:message", {
      gatewayId: gateway.id,
      gatewayPlatform: gateway.platform,
      sessionId: result.sessionId,
      taskIds: result.taskIds,
    });
    return {
      ok: true,
      gateway: {
        id: gateway.id,
        platform: gateway.platform,
        name: gateway.name,
      },
      sessionId: result.sessionId,
      status: result.status,
      taskIds: result.taskIds,
      response: result.response,
      delivery,
    };
  }

  async receiveGatewayInbound(input: {
    gatewayId: string;
    body: Record<string, unknown>;
    secret?: string;
  }): Promise<Record<string, unknown>> {
    this.powerhouse.start();
    const gateway = this.gateways.get(input.gatewayId);
    if (!gateway) return { ok: false, error: `unknown gateway: ${input.gatewayId}` };
    if (!gateway.enabled) return { ok: false, error: `gateway disabled: ${input.gatewayId}` };
    if (!verifyGatewaySecret(gateway.id, input.secret)) {
      this.gateways.touch(gateway.id, { status: "error", lastError: "invalid gateway secret" });
      return { ok: false, error: "invalid gateway secret" };
    }
    const inbound = parseGatewayInbound(gateway, input.body);
    if (inbound.challenge) return { ok: true, challenge: inbound.challenge };
    if (!inbound.stimulus.trim()) return { ok: false, error: "empty gateway message" };
    return this.receiveGatewayMessage({
      gatewayId: gateway.id,
      stimulus: inbound.stimulus,
      sessionId: inbound.sessionId,
      metadata: inbound.metadata,
      deliver: true,
    });
  }

  getHealingDetail(id: string): RuntimeHealingDetail | null {
    this.powerhouse.start();
    const failure = this.powerhouse.healing.getFailure(id) ?? null;
    const procedure = this.powerhouse.healing.getProcedure(id) ?? null;
    if (!failure && !procedure) return null;
    const fingerprint = failure?.fingerprint ?? procedure?.fingerprint ?? "";
    const relatedTasks = this.powerhouse
      .listTasks()
      .filter((task) => String(task.error ?? "").toLowerCase().includes(fingerprint) || task.status === "failed")
      .slice(-10)
      .map((task) => ({
        id: task.id,
        sessionId: task.sessionId,
        kind: task.kind,
        status: task.status,
        createdAt: new Date(task.createdAt).toISOString(),
        error: task.error ?? null,
      }));
    const audit = this.powerhouse
      .audit
      .list(250)
      .filter((entry) => entry.data?.fingerprint === fingerprint || entry.subjectId === procedure?.id || entry.subjectId === failure?.fingerprint)
      .map((entry) => ({ ...entry }));
    const logs = this.runtimeLogs
      .list(250)
      .filter((entry) => String(entry.message ?? "").includes(fingerprint))
      .map((entry) => ({ ...entry }));
    return {
      failure: failure
        ? {
            fingerprint: failure.fingerprint,
            count: failure.count,
            lastError: failure.lastError,
            firstSeenAt: new Date(failure.firstSeenAt).toISOString(),
            lastSeenAt: new Date(failure.lastSeenAt).toISOString(),
          }
        : null,
      procedure: procedure
        ? {
            id: procedure.id,
            fingerprint: procedure.fingerprint,
            status: procedure.status,
            summary: procedure.summary,
            createdAt: new Date(procedure.createdAt).toISOString(),
            updatedAt: new Date(procedure.updatedAt).toISOString(),
            uses: procedure.uses,
            successes: procedure.successes ?? 0,
            failures: procedure.failures ?? 0,
            lastUsedAt: procedure.lastUsedAt ? new Date(procedure.lastUsedAt).toISOString() : null,
            autoPromotedAt: procedure.autoPromotedAt ? new Date(procedure.autoPromotedAt).toISOString() : null,
            deprecatedReason: procedure.deprecatedReason ?? null,
          }
        : null,
      relatedTasks,
      audit,
      logs,
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

  getJob(id: string): Record<string, unknown> | null {
    const job = this.scheduler.list().find((item) => item.id === id);
    if (!job) return null;
    const audit = this.powerhouse
      .audit
      .list(250)
      .filter((entry) => entry.subjectId === id)
      .map((entry) => ({ ...entry }));
    const relatedTasks = this.powerhouse
      .listTasks()
      .filter((task) => task.payload?.stimulus === job.stimulus || task.id.includes(id))
      .map((task) => ({
        id: task.id,
        sessionId: task.sessionId,
        kind: task.kind,
        status: task.status,
        createdAt: new Date(task.createdAt).toISOString(),
        startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
        finishedAt: task.finishedAt ? new Date(task.finishedAt).toISOString() : null,
        error: task.error ?? null,
      }));
    return {
      job: {
        ...job,
        createdAt: new Date(job.createdAt).toISOString(),
        updatedAt: new Date(job.updatedAt).toISOString(),
        nextRunAt: job.nextRunAt ? new Date(job.nextRunAt).toISOString() : null,
        lastRunAt: job.lastRunAt ? new Date(job.lastRunAt).toISOString() : null,
      },
      audit,
      relatedTasks,
    };
  }

  createJob(input: {
    name: string;
    stimulus: string;
    schedule?: string;
    intervalMs?: number;
    script?: string;
    noAgent?: boolean;
    workdir?: string;
    skills?: string[];
    enabled?: boolean;
  }): Record<string, unknown> {
    return this.scheduler.create(input) as unknown as Record<string, unknown>;
  }

  updateJob(id: string, input: {
    name?: string;
    stimulus?: string;
    schedule?: string;
    intervalMs?: number;
    script?: string | null;
    noAgent?: boolean;
    workdir?: string | null;
    skills?: string[];
    enabled?: boolean;
  }): Record<string, unknown> {
    const job = this.scheduler.update(id, input);
    return { ok: Boolean(job), job };
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

  async runDueJobs(): Promise<Record<string, unknown>> {
    const jobs = await this.scheduler.runDue();
    return {
      ok: true,
      count: jobs.length,
      jobs,
    };
  }

  usage(): Record<string, unknown> {
    const sessions = this.powerhouse.listSessions();
    const tasks = this.powerhouse.listTasks();
    const plans = this.powerhouse.planStore.list();
    const jobs = this.scheduler.list();
    const gateways = this.gateways.list();
    const memory = this.powerhouse.memory.list();
    const tasksByStatus: Record<string, number> = {};
    const jobsByLastStatus: Record<string, number> = {};

    for (const task of tasks) {
      tasksByStatus[task.status] = (tasksByStatus[task.status] ?? 0) + 1;
    }
    for (const job of jobs) {
      const status = job.lastStatus ?? "never-run";
      jobsByLastStatus[status] = (jobsByLastStatus[status] ?? 0) + 1;
    }

    return {
      generatedAt: new Date().toISOString(),
      counts: {
        sessions: sessions.length,
        tasks: tasks.length,
        plans: plans.length,
        jobs: jobs.length,
        gateways: gateways.length,
        enabledGateways: gateways.filter((gateway) => gateway.enabled).length,
        memory: memory.length,
      },
      tasksByStatus,
      jobsByLastStatus,
      enabledGateways: gateways.filter((gateway) => gateway.enabled).map((gateway) => gateway.id),
      note: "Provider token and cost usage is not persisted yet; this reports backend runtime usage.",
    };
  }

  config(): Record<string, unknown> {
    const config = loadConfig();
    return {
      model: config.model,
      provider: config.provider,
      baseUrl: config.baseUrl,
      sessionTtlMs: config.sessionTtlMs,
      approvalTimeoutMs: config.approvalTimeoutMs,
      inboxPort: config.inboxPort,
      bridgePort: config.bridgePort,
      dataDir: config.dataDir,
      workspace: PATHS.workspaceRoot,
      configFile: PATHS.configFile,
      llmApiKeyConfigured: Boolean(config.llmApiKey),
      sessionTokenConfigured: Boolean(config.sessionToken),
      storedAuthTokens: defaultAuthTokenStore.list().length,
    };
  }

  authStatus(): Record<string, unknown> {
    const config = loadConfig();
    const tokens = defaultAuthTokenStore.list();
    return {
      envSessionTokenConfigured: Boolean(config.sessionToken),
      storedTokens: tokens.length,
      roles: tokens.reduce<Record<string, number>>((acc, token) => {
        acc[token.role] = (acc[token.role] ?? 0) + 1;
        return acc;
      }, {}),
      mode: config.sessionToken || tokens.length > 0 ? "token-required" : "loopback-dev-open",
    };
  }

  listAuthTokens(): Record<string, unknown> {
    return { tokens: defaultAuthTokenStore.list() };
  }

  createAuthToken(input: { label?: string; role?: AuthRole } = {}): Record<string, unknown> {
    const created = defaultAuthTokenStore.create(input);
    this.powerhouse.audit.record({
      type: "auth.token_created",
      actor: "user",
      subjectId: created.record.id,
      data: { label: created.record.label, role: created.record.role },
    });
    return {
      ok: true,
      token: created.token,
      record: created.record,
      warning: "Copy this token now. Agentix stores only its hash and cannot show it again.",
    };
  }

  revokeAuthToken(id: string): Record<string, unknown> {
    const revoked = defaultAuthTokenStore.revoke(id);
    if (revoked) {
      this.powerhouse.audit.record({
        type: "auth.token_revoked",
        actor: "user",
        subjectId: id,
        data: {},
      });
    }
    return { ok: revoked, id };
  }

  setConfigValue(key: string, value: unknown): Record<string, unknown> {
    const normalized = key.trim();
    const numericKeys = new Set([
      "sessionTtlMs",
      "approvalTimeoutMs",
      "inboxPort",
      "bridgePort",
    ]);
    const stringKeys = new Set(["model", "provider", "baseUrl"]);
    if (!numericKeys.has(normalized) && !stringKeys.has(normalized)) {
      return {
        ok: false,
        error: `unsupported config key: ${normalized}`,
        allowedKeys: [...stringKeys, ...numericKeys],
      };
    }

    let parsed: string | number | null;
    if (numericKeys.has(normalized)) {
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) {
        return { ok: false, error: `${normalized} must be a positive number` };
      }
      parsed = number;
    } else {
      const text = String(value ?? "").trim();
      parsed = normalized === "baseUrl" && !text ? null : text;
      if (normalized !== "baseUrl" && !parsed) {
        return { ok: false, error: `${normalized} cannot be empty` };
      }
    }

    saveConfig({ [normalized]: parsed } as Partial<AgentixConfig>);
    this.powerhouse.audit.record({
      type: "config.updated",
      actor: "user",
      subjectId: normalized,
      data: { key: normalized, value: parsed },
    });
    return { ok: true, key: normalized, value: parsed, config: this.config() };
  }

  doctor(): Record<string, unknown> {
    this.powerhouse.start();
    const config = loadConfig();
    const tasks = this.powerhouse.listTasks();
    const agents = this.powerhouse.agents.list();
    const agentProfiles = this.powerhouse.agentProfiles.list();
    const gateways = this.gateways.list();
    const jobs = this.scheduler.list();
    const healing = this.powerhouse.healing.listProcedures();
    const packageMetadata = PACKAGE_METADATA;
    const requiredInstallAssets = [
      join(PATHS.installRoot, "bin", process.platform === "win32" ? "agentix.js" : "agentix.js"),
      PATHS.bridgeEntry,
      PATHS.inboxEntry,
      join(PATHS.installRoot, "frontend", "dist", "index.html"),
      join(PATHS.installRoot, "install.sh"),
      join(PATHS.installRoot, "install.ps1"),
      join(PATHS.hermesRoot, "pyproject.toml"),
    ];
    const missingInstallAssets = requiredInstallAssets.filter((asset) => !existsSync(asset));
    const sandboxMode = process.env.AGENTIX_SANDBOX_MODE ?? "auto";
    const sandboxImage = process.env.AGENTIX_SANDBOX_DOCKER_IMAGE ?? "node:22-alpine";
    const sandboxDockerReady = sandboxMode !== "local" && dockerSandboxAvailable(sandboxImage);
    const checks: Array<{
      id: string;
      label: string;
      status: "pass" | "warn" | "fail";
      detail: string;
      action?: string;
    }> = [];
    const add = (
      id: string,
      label: string,
      status: "pass" | "warn" | "fail",
      detail: string,
      action?: string,
    ) => checks.push({ id, label, status, detail, ...(action ? { action } : {}) });

    add(
      "paths.data",
      "Data directory",
      existsSync(PATHS.dataDir) ? "pass" : "fail",
      PATHS.dataDir,
      existsSync(PATHS.dataDir) ? undefined : "Run agentix setup or agentix server to initialize runtime directories.",
    );
    add(
      "paths.hermes",
      "Hermes frontend",
      existsSync(PATHS.hermesRoot) ? "pass" : "fail",
      PATHS.hermesRoot,
      existsSync(PATHS.hermesRoot) ? undefined : "Reinstall Agentix or restore the bundled hermes-agent directory.",
    );
    add(
      "install.package",
      "Installed package",
      packageMetadata.version === "unknown" ? "warn" : "pass",
      `${packageMetadata.name}@${packageMetadata.version}`,
      packageMetadata.version === "unknown" ? "Ensure package.json is included in the installed Agentix package." : undefined,
    );
    add(
      "install.assets",
      "Installed runtime assets",
      missingInstallAssets.length ? "fail" : "pass",
      missingInstallAssets.length
        ? `missing ${missingInstallAssets.length}: ${missingInstallAssets.join(", ")}`
        : "bin, backend dist, dashboard, installers, and Hermes frontend present",
      missingInstallAssets.length ? "Reinstall Agentix from npm or a verified release tarball." : undefined,
    );
    add(
      "config.model",
      "Model configuration",
      config.model ? "pass" : "fail",
      `${config.provider || "auto"} / ${config.model || "missing"}`,
      config.model ? undefined : "Run agentix setup or agentix model.",
    );
    add(
      "config.llm",
      "LLM API key",
      config.llmApiKey ? "pass" : "warn",
      config.llmApiKey ? "Configured" : "Missing; planner and conversation agents will use deterministic fallbacks.",
      config.llmApiKey ? undefined : "Run agentix setup or export AGENTIX_LLM_API_KEY.",
    );
    const expectedKinds = ["user-message", "bash", "code-edit", "sandbox-run"];
    const missingKinds = expectedKinds.filter((kind) => !agents.some((agent) => agent.kind === kind));
    const unhealthyAgents = agents.filter((agent) => !agent.healthy());
    add(
      "agents.pi",
      "Pi agents",
      missingKinds.length || unhealthyAgents.length ? "fail" : "pass",
      `${agents.length} registered; missing ${missingKinds.join(", ") || "none"}; unhealthy ${unhealthyAgents.map((agent) => agent.id).join(", ") || "none"}`,
      missingKinds.length || unhealthyAgents.length ? "Restart the backend and inspect tool details." : undefined,
    );
    add(
      "sandbox.isolation",
      "Sandbox isolation",
      sandboxMode === "docker" && !sandboxDockerReady ? "fail" : sandboxMode === "local" || !sandboxDockerReady ? "warn" : "pass",
      sandboxDockerReady
        ? `Docker isolation ready with image ${sandboxImage}`
        : `Using local sandbox fallback; mode=${sandboxMode}, image=${sandboxImage}`,
      sandboxDockerReady ? undefined : "Install Docker and pull the configured image, or set AGENTIX_SANDBOX_MODE=local if this is intentional.",
    );
    const disabledProfiles = agentProfiles.filter((profile) => !profile.enabled);
    add(
      "agents.dynamic_profiles",
      "Dynamic Pi profiles",
      "pass",
      `${agentProfiles.length} profile(s), ${disabledProfiles.length} disabled`,
    );
    const pendingApprovals = tasks.filter((task) => task.status === "awaiting-approval");
    add(
      "runtime.approvals",
      "Pending approvals",
      pendingApprovals.length ? "warn" : "pass",
      `${pendingApprovals.length} approval(s) pending`,
      pendingApprovals.length ? "Review the dashboard Approvals panel or run /approval <id> approve|reject." : undefined,
    );
    const failedTasks = tasks.filter((task) => task.status === "failed");
    add(
      "runtime.failures",
      "Failed tasks",
      failedTasks.length ? "warn" : "pass",
      `${failedTasks.length} failed task(s) recorded`,
      failedTasks.length ? "Inspect failed tasks and healing procedures." : undefined,
    );
    const enabledGateways = gateways.filter((gateway) => gateway.enabled);
    const enabledGatewaysMissingToken = enabledGateways.filter((gateway) => !gateway.tokenConfigured && gateway.platform !== "webhook");
    add(
      "integrations.gateway",
      "Gateway integrations",
      enabledGatewaysMissingToken.length ? "warn" : "pass",
      `${gateways.length} gateway(s), ${enabledGateways.length} enabled`,
      enabledGatewaysMissingToken.length ? "Configure credentials for enabled gateway integrations." : undefined,
    );
    const failedJobs = jobs.filter((job) => job.lastStatus === "failure");
    add(
      "scheduler.jobs",
      "Scheduler jobs",
      failedJobs.length ? "warn" : "pass",
      `${jobs.length} job(s), ${failedJobs.length} recent failure(s)`,
      failedJobs.length ? "Inspect Scheduler job detail and lastError." : undefined,
    );
    const promotedProcedures = healing.filter((procedure) => procedure.status === "promoted");
    add(
      "healing.procedures",
      "Healing procedures",
      "pass",
      `${healing.length} procedure(s), ${promotedProcedures.length} promoted`,
    );

    const status = checks.some((check) => check.status === "fail")
      ? "fail"
      : checks.some((check) => check.status === "warn")
        ? "warn"
        : "pass";

    return {
      status,
      generatedAt: new Date().toISOString(),
      workspace: PATHS.workspaceRoot,
      dataDir: PATHS.dataDir,
      installRoot: PATHS.installRoot,
      checks,
      counts: {
        sessions: this.powerhouse.listSessions().length,
        tasks: tasks.length,
        plans: this.powerhouse.planStore.list().length,
        approvals: pendingApprovals.length,
        jobs: jobs.length,
        gateways: gateways.length,
        memory: this.powerhouse.memory.list().length,
        healingProcedures: healing.length,
        agentProfiles: agentProfiles.length,
      },
      config: {
        provider: config.provider,
        model: config.model,
        baseUrl: config.baseUrl,
        llmApiKeyConfigured: Boolean(config.llmApiKey),
        sessionTokenConfigured: Boolean(config.sessionToken),
      },
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      install: {
        packageName: packageMetadata.name,
        packageVersion: packageMetadata.version,
        installRoot: PATHS.installRoot,
        missingAssets: missingInstallAssets,
      },
    };
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
    const gateways = this.listGateways();
    const agentProfiles = this.listAgentProfiles();
    const plans = this.powerhouse.planStore.list();
    const doctor = this.doctor();
    const packageMetadata = PACKAGE_METADATA;
    const audit = this.listAudit();
    const healing = this.healingStats();
    const memory = this.powerhouse.memory.list().slice(-250);

    writeJson("manifest.json", {
      createdAt: new Date().toISOString(),
      bundleId,
      packageName: packageMetadata.name,
      version: packageMetadata.version,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      installRoot: PATHS.installRoot,
      projectRoot: PATHS.projectRoot,
      dataDir: PATHS.dataDir,
      counts: {
        sessions: sessions.length,
        tasks: tasks.length,
        plans: plans.length,
        approvals: approvals.length,
        jobs: jobs.length,
        gateways: gateways.length,
        audit: audit.length,
        memory: memory.length,
        healingFailures: Array.isArray((healing as { failures?: unknown[] }).failures)
          ? ((healing as { failures?: unknown[] }).failures?.length ?? 0)
          : 0,
        healingProcedures: Array.isArray((healing as { procedures?: unknown[] }).procedures)
          ? ((healing as { procedures?: unknown[] }).procedures?.length ?? 0)
          : 0,
        agentProfiles: Array.isArray((agentProfiles as { profiles?: unknown[] }).profiles)
          ? ((agentProfiles as { profiles?: unknown[] }).profiles?.length ?? 0)
          : 0,
      },
    });
    writeJson("config.json", safeConfig);
    writeJson("doctor.json", doctor);
    writeJson("sessions.json", sessions);
    writeJson("tasks.json", tasks);
    writeJson("plans.json", plans);
    writeJson("approvals.json", approvals);
    writeJson("jobs.json", jobs);
    writeJson("gateways.json", gateways);
    writeJson("agent-profiles.json", agentProfiles);
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
        "doctor.json",
        "sessions.json",
        "tasks.json",
        "plans.json",
        "approvals.json",
        "jobs.json",
        "gateways.json",
        "agent-profiles.json",
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
