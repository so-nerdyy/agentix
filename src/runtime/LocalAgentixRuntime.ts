import { Powerhouse } from "../powerhouse/Powerhouse.js";
import { SchedulerService } from "../scheduler/SchedulerService.js";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../config/paths.js";
import { EventBus } from "../config/EventBus.js";
import { loadConfig } from "../config/index.js";
import { randomUUID } from "node:crypto";
import { RuntimeLogStore } from "../logging/RuntimeLogStore.js";
import type { TaskAction } from "../powerhouse/types.js";
import { GatewayRegistry } from "../gateway/GatewayRegistry.js";

export type RuntimeSearchResults = {
  query: string;
  tasks: Array<{ id: string; sessionId: string; kind: string; status: string; createdAt: string; summary: string }>;
  sessions: Array<{ id: string; status: string; createdAt: string; updatedAt: string; metadata: Record<string, unknown> }>;
  memory: Array<{ id: string; sessionId: string; taskId: string | null; role: string; content: string; createdAt: string; tags: string[] }>;
  audit: Array<{ id: string; type: string; actor: string; subjectId: string | null; createdAt: string; data: Record<string, unknown> }>;
  logs: Array<Record<string, unknown>>;
  jobs: Array<{ id: string; name: string; stimulus: string; enabled: boolean; intervalMs: number; nextRunAt: string; lastRunAt: string | null; runCount: number }>;
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

export class LocalAgentixRuntime {
  private readonly powerhouse = new Powerhouse();
  private readonly scheduler = new SchedulerService(this.powerhouse);
  private readonly runtimeLogs = new RuntimeLogStore();
  private readonly gateways = new GatewayRegistry();

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
        intervalMs: job.intervalMs,
        nextRunAt: new Date(job.nextRunAt).toISOString(),
        lastRunAt: job.lastRunAt ? new Date(job.lastRunAt).toISOString() : null,
        runCount: job.runCount,
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
      healing,
      gateways,
    };
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

  controlTask(taskId: string, action: TaskAction): Record<string, unknown> {
    const result = this.powerhouse.controlTask(taskId, action);
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
        tokenConfigured: gateway.tokenConfigured,
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
    this.powerhouse.audit.record({
      type: "gateway.message.received",
      actor: "gateway",
      subjectId: gateway.id,
      data: {
        gatewayId: gateway.id,
        gatewayPlatform: gateway.platform,
        sessionId: result.sessionId,
        taskIds: result.taskIds,
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
    };
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
        nextRunAt: new Date(job.nextRunAt).toISOString(),
        lastRunAt: job.lastRunAt ? new Date(job.lastRunAt).toISOString() : null,
      },
      audit,
      relatedTasks,
    };
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
    const gateways = this.listGateways();
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
        gateways: gateways.length,
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
    writeJson("gateways.json", gateways);
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
        "gateways.json",
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
