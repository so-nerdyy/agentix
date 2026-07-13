import { Powerhouse } from "../powerhouse/Powerhouse.js";
import { SchedulerService } from "../scheduler/SchedulerService.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PATHS } from "../config/paths.js";
import { EventBus } from "../config/EventBus.js";
import {
  inspectConfigSources,
  loadConfig,
  saveConfig,
  saveWorkspaceConfigOverride,
  saveWorkspaceLlmApiKey,
  type AgentixConfig,
} from "../config/index.js";
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
import { LLMClient } from "../llm/LLMClient.js";

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

function inspectStateIntegrity(root: string): { issues: string[]; scanned: number; truncated: boolean } {
  if (!existsSync(root)) return { issues: [], scanned: 0, truncated: false };
  const issues: string[] = [];
  const pending: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let scanned = 0;
  let truncated = false;

  while (pending.length > 0 && scanned < 2_000) {
    const current = pending.pop()!;
    let entries;
    try {
      entries = readdirSync(current.dir, { withFileTypes: true });
    } catch {
      issues.push(`${relative(root, current.dir) || "."}: directory could not be read`);
      continue;
    }
    for (const entry of entries) {
      if (scanned >= 2_000) {
        truncated = true;
        break;
      }
      const path = join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < 8 && entry.name !== "support") {
          pending.push({ dir: path, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      scanned += 1;
      const display = relative(root, path);
      if (entry.name.includes(".corrupt-")) {
        issues.push(`${display}: preserved corrupt-state backup`);
        continue;
      }
      if (!entry.name.endsWith(".json")) continue;
      try {
        if (statSync(path).size > 16 * 1024 * 1024) {
          issues.push(`${display}: JSON state exceeds the 16 MiB validation limit`);
          continue;
        }
        JSON.parse(readFileSync(path, "utf-8"));
      } catch {
        issues.push(`${display}: invalid or unreadable JSON state`);
      }
    }
  }
  if (pending.length > 0) truncated = true;
  return { issues, scanned, truncated };
}

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
  messages: Array<{ role: string; content: string; ts: number }>;
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
  private readonly powerhouse: Powerhouse;
  private readonly scheduler: SchedulerService;
  private readonly runtimeLogs: RuntimeLogStore;
  private readonly gateways: GatewayRegistry;

  constructor(opts: { powerhouse?: Powerhouse; startScheduler?: boolean } = {}) {
    this.powerhouse = opts.powerhouse ?? new Powerhouse();
    this.scheduler = new SchedulerService(this.powerhouse);
    this.runtimeLogs = new RuntimeLogStore();
    this.gateways = new GatewayRegistry();
    if (opts.startScheduler ?? true) this.scheduler.start();
  }

  listSessions(opts: { limit?: number; recover?: boolean } = {}): Array<{
    id: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    metadata: Record<string, unknown>;
    messageCount: number;
    preview: string;
  }> {
    const sessions = opts.limit
      ? this.powerhouse.sessions.listRecent(opts.limit)
      : (() => {
          this.powerhouse.start({ recover: opts.recover ?? true });
          return this.powerhouse.listSessions();
        })();
    return sessions.map((session) => {
      const messages = session.messages ?? [];
      const preview = [...messages]
        .reverse()
        .map((message) => message.content.trim())
        .find(Boolean) ?? "";
      return {
        id: session.id,
        status: session.status,
        createdAt: new Date(session.createdAt).toISOString(),
        updatedAt: new Date(session.updatedAt).toISOString(),
        metadata: session.metadata,
        messageCount: messages.length,
        preview: preview.replace(/\s+/g, " ").slice(0, 160),
      };
    });
  }

  createSession(opts?: {
    model?: string;
    provider?: string;
    baseUrl?: string;
    toolsets?: unknown;
    skills?: string[];
    metadata?: Record<string, unknown>;
    messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  }): { id: string } {
    const session = this.powerhouse.createSession({
      ...(opts?.metadata ?? {}),
      model: opts?.model ?? null,
      provider: opts?.provider ?? null,
      baseUrl: opts?.baseUrl ?? null,
      toolsets: opts?.toolsets ?? null,
      skills: opts?.skills ?? null,
      source: "agentix-runtime",
    });
    for (const message of (opts?.messages ?? []).slice(-1000)) {
      if (!["system", "user", "assistant"].includes(message.role)) continue;
      if (typeof message.content !== "string" || !message.content.trim()) continue;
      this.powerhouse.sessions.appendMessage(session.id, message);
    }
    return { id: session.id };
  }

  deleteSession(id: string): Record<string, unknown> {
    const result = this.powerhouse.deleteSession(id);
    return result.ok ? { ok: true, deleted: id } : result;
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
    this.powerhouse.start({ recover: false });
    return this.powerhouse.agents.list().map((agent) => ({
      name: agent.kind,
      description: `Pi agent ${agent.id} handles ${agent.kind} tasks.`,
    }));
  }

  listSkills(query = ""): Array<Record<string, unknown>> {
    return this.powerhouse.skills.list(query).map((skill) => ({ ...skill }));
  }

  getSkill(id: string): Record<string, unknown> | null {
    const skill = this.powerhouse.skills.get(id);
    return skill ? { ...skill } : null;
  }

  setSkillEnabled(id: string, enabled: boolean): Record<string, unknown> {
    const skill = this.powerhouse.skills.setEnabled(id, enabled);
    if (!skill) return { ok: false, error: `unknown Agentix skill: ${id}` };
    this.powerhouse.audit.record({
      type: enabled ? "skill.enabled" : "skill.disabled",
      actor: "user",
      subjectId: skill.id,
      data: { skillId: skill.id, source: skill.source },
    });
    return { ok: true, skill };
  }

  reloadSkills(): Record<string, unknown> {
    const skills = this.powerhouse.skills.reload().map((skill) => ({ ...skill }));
    this.powerhouse.audit.record({
      type: "skills.reloaded",
      actor: "user",
      data: { count: skills.length },
    });
    return { ok: true, count: skills.length, skills };
  }

  getTool(toolId: string): RuntimeToolDetail | null {
    this.powerhouse.start({ recover: false });
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
    this.powerhouse.start({ recover: false });
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

  removeAgentProfile(id: string): Record<string, unknown> {
    const profile = this.powerhouse.removeAgentProfile(id);
    if (profile) {
      this.powerhouse.audit.record({
        type: "agent.profile_removed",
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
      return {
        ok: !["failed", "cancelled"].includes(result.status),
        action,
        sourcePlanId: planId,
        result,
      };
    }

    if (action === "cancel") {
      const result = this.powerhouse.cancelPlan(planId);
      return {
        ...result,
        action,
        planId,
        count: result.taskIds.length,
      };
    }

    if (action === "retry-failed") {
      if (execution.status !== "failed") {
        return { ok: false, error: "plan is not failed: " + planId, status: execution.status };
      }
      const beforeTaskIds = new Set(tasks.map((task) => task.id));
      const result = await this.powerhouse.retryPlan(planId);
      if (!result) return { ok: false, error: "plan could not be retried: " + planId };
      const createdTaskIds = this.powerhouse
        .listTasks(execution.sessionId)
        .filter((task) => task.planId === planId && !beforeTaskIds.has(task.id))
        .map((task) => task.id);
      this.powerhouse.audit.record({
        type: "plan.retry_failed",
        actor: "user",
        subjectId: planId,
        data: {
          sessionId: execution.sessionId,
          taskIds: createdTaskIds,
          status: result.status,
        },
      });
      return {
        ok: !["failed", "cancelled"].includes(result.status),
        action,
        planId,
        count: createdTaskIds.length,
        taskIds: createdTaskIds,
        result,
      };
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
    const messages = this.powerhouse.sessions.getMessages(sessionId).map((message) => ({ ...message }));
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
      messages,
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
    onDelta?: (delta: string) => void;
    model?: string;
    provider?: string;
    baseUrl?: string;
    toolsets?: unknown;
    skills?: string[];
    signal?: AbortSignal;
  }): Promise<Record<string, unknown>> {
    this.powerhouse.start();
    const gateway = this.gateways.get(input.gatewayId);
    if (!gateway) {
      throw new Error(`unknown gateway: ${input.gatewayId}`);
    }
    this.gateways.recordMessage(gateway.id, { status: "connected" });
    const existingSession = input.sessionId
      ? this.powerhouse.listSessions().find((session) => session.id === input.sessionId)
      : undefined;
    if (existingSession) {
      this.powerhouse.sessions.updateMetadata(existingSession.id, {
        ...(input.metadata ?? {}),
        source: "gateway",
        gatewayId: gateway.id,
        gatewayPlatform: gateway.platform,
        gatewayName: gateway.name,
      });
    }
    const session = existingSession ?? this.powerhouse.createSession({
      ...(input.metadata ?? {}),
      source: "gateway",
      gatewayId: gateway.id,
      gatewayPlatform: gateway.platform,
      gatewayName: gateway.name,
    });
    const result = await this.powerhouse.executeStimulus({
      stimulus: input.stimulus,
      sessionId: session.id,
      onDelta: input.onDelta,
      model: input.model,
      provider: input.provider,
      baseUrl: input.baseUrl,
      toolsets: input.toolsets,
      skills: input.skills,
      signal: input.signal,
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
    this.powerhouse.start({ recover: false });
    const tasks = this.powerhouse.listTasks();
    const plans = this.powerhouse.planStore.list();
    const jobs = this.scheduler.list();
    const gateways = this.gateways.list();
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
      title: "Agentix backend usage",
      generatedAt: new Date().toISOString(),
      counts: {
        sessions: this.powerhouse.sessions.count(),
        tasks: tasks.length,
        plans: plans.length,
        jobs: jobs.length,
        gateways: gateways.length,
        enabledGateways: gateways.filter((gateway) => gateway.enabled).length,
        memory: this.powerhouse.memory.count(),
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
      lunaModel: config.lunaModel,
      terraModel: config.terraModel,
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
    const stringKeys = new Set(["model", "provider", "baseUrl", "lunaModel", "terraModel"]);
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
      parsed = ["baseUrl", "lunaModel", "terraModel"].includes(normalized) && !text ? null : text;
      if (!["baseUrl", "lunaModel", "terraModel"].includes(normalized) && !parsed) {
        return { ok: false, error: `${normalized} cannot be empty` };
      }
    }

    saveWorkspaceConfigOverride(normalized as keyof AgentixConfig, parsed);
    saveConfig({ [normalized]: parsed } as Partial<AgentixConfig>);
    this.powerhouse.audit.record({
      type: "config.updated",
      actor: "user",
      subjectId: normalized,
      data: { key: normalized, value: parsed },
    });
    return { ok: true, key: normalized, value: parsed, config: this.config() };
  }

  setLlmApiKey(value: unknown): Record<string, unknown> {
    const secret = typeof value === "string" ? value.trim() : "";
    saveWorkspaceLlmApiKey(secret || null);
    this.powerhouse.audit.record({
      type: secret ? "config.secret_updated" : "config.secret_removed",
      actor: "user",
      subjectId: "AGENTIX_LLM_API_KEY",
      data: { key: "AGENTIX_LLM_API_KEY", configured: Boolean(secret) },
    });
    return {
      ok: true,
      configured: Boolean(secret),
      config: this.config(),
    };
  }

  undoSession(id: string): Record<string, unknown> {
    return this.powerhouse.undoSession(id);
  }

  truncateSessionBeforeUserOrdinal(id: string, ordinal: number): Record<string, unknown> {
    this.powerhouse.start();
    if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
      return { ok: false, error: "user ordinal must be a non-negative integer" };
    }
    const session = this.powerhouse.sessions.get(id);
    if (!session) return { ok: false, error: `unknown session: ${id}` };
    const userIndices = session.messages
      .map((message, index) => message.role === "user" ? index : -1)
      .filter((index) => index >= 0);
    if (ordinal >= userIndices.length) {
      return { ok: false, error: "target user message is no longer in session history" };
    }
    const beforeMessages = session.messages.length;
    const replacement = session.messages.slice(0, userIndices[ordinal]);
    const result = this.powerhouse.replaceSessionHistory(
      id,
      replacement,
      `truncate-before-user-${ordinal}`,
    );
    return result.ok
      ? {
          ...result,
          removed: beforeMessages - (result.messages?.length ?? 0),
          ordinal,
        }
      : result;
  }

  branchSession(id: string, title?: string): Record<string, unknown> {
    const result = this.powerhouse.branchSession(id, title);
    if (!result.ok || !result.session) return result;
    return {
      ok: true,
      id: result.session.id,
      parentSessionId: id,
      title: result.session.metadata.title,
      messages: result.session.messages,
    };
  }

  async compactSession(id: string, focusTopic?: string): Promise<Record<string, unknown>> {
    this.powerhouse.start();
    const session = this.powerhouse.sessions.get(id);
    if (!session) return { ok: false, error: `unknown session: ${id}` };
    const before = session.messages.map((message) => ({ ...message }));
    if (before.length < 6) {
      return {
        ok: true,
        status: "unchanged",
        removed: 0,
        beforeMessages: before.length,
        afterMessages: before.length,
        messages: before,
        summary: "The session is already compact.",
      };
    }
    const keepCount = Math.min(6, Math.max(2, Math.floor(before.length / 3)));
    const older = before.slice(0, -keepCount);
    const recent = before.slice(-keepCount);
    const focus = String(focusTopic ?? "").trim();
    const completion = await new LLMClient(loadConfig()).complete([
      {
        role: "system",
        content: [
          "Summarize this Agentix session history for future continuation.",
          "Preserve decisions, requirements, file paths, commands, failures, unresolved work, and user preferences.",
          "Do not invent actions or results.",
          focus ? `Prioritize this focus: ${focus}` : "",
        ].filter(Boolean).join(" "),
      },
      {
        role: "user",
        content: older.map((message) => `${message.role}: ${message.content}`).join("\n\n"),
      },
    ], { timeoutMs: 120_000, maxAttempts: 2 });
    if (!completion.ok || !completion.text) {
      return { ok: false, error: completion.error || "session compaction failed" };
    }
    const replacement = [
      { role: "system" as const, content: `Earlier session summary:\n${completion.text}` },
      ...recent,
    ];
    const replaced = this.powerhouse.replaceSessionHistory(id, replacement, "model-backed-compaction");
    if (!replaced.ok) return replaced;
    return {
      ok: true,
      status: "compressed",
      removed: before.length - (replaced.messages?.length ?? 0),
      beforeMessages: before.length,
      afterMessages: replaced.messages?.length ?? 0,
      messages: replaced.messages,
      summary: completion.text,
    };
  }

  doctor(): Record<string, unknown> {
    this.powerhouse.start({ recover: false });
    const config = loadConfig();
    const configIssues = inspectConfigSources();
    const tasks = this.powerhouse.listTasks();
    const agents = this.powerhouse.agents.list();
    const agentProfiles = this.powerhouse.agentProfiles.list();
    const gateways = this.gateways.list();
    const jobs = this.scheduler.list();
    const healing = this.powerhouse.healing.listProcedures();
    const stateIntegrity = inspectStateIntegrity(PATHS.dataDir);
    const packageMetadata = PACKAGE_METADATA;
    const requiredInstallAssets = [
      join(PATHS.installRoot, "bin", process.platform === "win32" ? "agentix.js" : "agentix.js"),
      PATHS.bridgeEntry,
      PATHS.inboxEntry,
      join(PATHS.installRoot, "frontend", "dist", "index.html"),
      join(PATHS.installRoot, "install.sh"),
      join(PATHS.installRoot, "install.ps1"),
      join(PATHS.compatibilityRuntimeRoot, "pyproject.toml"),
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
      "paths.compatibility",
      "Bundled Agentix shell runtime",
      existsSync(PATHS.compatibilityRuntimeRoot) ? "pass" : "fail",
      existsSync(PATHS.compatibilityRuntimeRoot) ? "Agentix shell runtime available" : "Agentix shell runtime missing",
      existsSync(PATHS.compatibilityRuntimeRoot) ? undefined : "Reinstall Agentix to restore the bundled shell runtime.",
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
        ? `${missingInstallAssets.length} required runtime asset(s) missing`
        : "bin, backend dist, dashboard, installers, and bundled Agentix shell runtime present",
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
      "state.integrity",
      "Persisted state integrity",
      stateIntegrity.issues.length > 0 || stateIntegrity.truncated ? "warn" : "pass",
      stateIntegrity.issues.length > 0
        ? `${stateIntegrity.issues.length} issue(s): ${stateIntegrity.issues.slice(0, 5).join("; ")}`
        : stateIntegrity.truncated
          ? `Validation stopped after ${stateIntegrity.scanned} files`
          : `${stateIntegrity.scanned} state file(s) checked`,
      stateIntegrity.issues.length > 0 || stateIntegrity.truncated
        ? "Generate a support bundle, inspect preserved corrupt files, and repair or remove them after backup."
        : undefined,
    );
    add(
      "config.sources",
      "Configuration files",
      configIssues.some((issue) => issue.severity === "fail")
        ? "fail"
        : configIssues.length > 0
          ? "warn"
          : "pass",
      configIssues.length > 0
        ? configIssues.map((issue) => issue.detail).join("; ")
        : "Configuration files are readable and structurally valid",
      configIssues.length > 0
        ? "Repair the reported file or rerun agentix setup, then run agentix doctor again."
        : undefined,
    );
    add(
      "config.llm",
      "LLM API key",
      config.llmApiKey ? "pass" : "warn",
      config.llmApiKey ? "Configured" : "Missing; model-backed planning and conversation tasks will fail with an actionable error.",
      config.llmApiKey ? undefined : "Run agentix setup or export AGENTIX_LLM_API_KEY.",
    );
    const expectedKinds = [
      "user-message",
      "bash",
      "code-edit",
      "sandbox-run",
      ...(config.lunaModel ? ["luna-message"] : []),
      ...(config.terraModel ? ["terra-message"] : []),
    ];
    const missingKinds = expectedKinds.filter((kind) => !agents.some((agent) => agent.kind === kind));
    const unhealthyAgents = agents.filter((agent) => !agent.healthy());
    add(
      "agents.pi",
      "Pi agents",
      missingKinds.length || unhealthyAgents.length ? "fail" : "pass",
      `${agents.length} registered; missing ${missingKinds.join(", ") || "none"}; unhealthy ${unhealthyAgents.map((agent) => agent.id).join(", ") || "none"}`,
      missingKinds.length || unhealthyAgents.length ? "Restart the backend and inspect tool details." : undefined,
    );
    for (const [role, model] of [["luna", config.lunaModel], ["terra", config.terraModel]] as const) {
      const registered = agents.some((agent) => agent.kind === `${role}-message`);
      add(
        `delegation.${role}`,
        `${role[0]!.toUpperCase()}${role.slice(1)} delegation`,
        model ? (registered ? "pass" : "fail") : "warn",
        model
          ? `${model}; ${registered ? "Pi agent registered" : "Pi agent missing"}`
          : `Not configured; set AGENTIX_${role.toUpperCase()}_MODEL to enable this delegation path.`,
        model && !registered ? "Restart the Agentix backend after changing delegate model configuration." : undefined,
      );
    }
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
        sessions: this.powerhouse.sessions.count(),
        tasks: tasks.length,
        plans: this.powerhouse.planStore.list().length,
        approvals: pendingApprovals.length,
        jobs: jobs.length,
        gateways: gateways.length,
        memory: this.powerhouse.memory.count(),
        healingProcedures: healing.length,
        agentProfiles: agentProfiles.length,
      },
      config: {
        provider: config.provider,
        model: config.model,
        baseUrl: config.baseUrl,
        lunaModel: config.lunaModel,
        terraModel: config.terraModel,
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

  readiness(): Record<string, unknown> {
    const doctor = this.doctor() as {
      status?: string;
      checks?: Array<{ id?: string; status?: string; detail?: string; action?: string }>;
      config?: { llmApiKeyConfigured?: boolean; sessionTokenConfigured?: boolean };
      install?: { packageVersion?: string; missingAssets?: string[] };
    };
    const checks = Array.isArray(doctor.checks) ? doctor.checks : [];
    const failures = checks.filter((check) => check.status === "fail");
    const warnings = checks.filter((check) => check.status === "warn");
    const byId = new Map(checks.map((check) => [check.id, check]));
    const gate = (
      id: string,
      label: string,
      ok: boolean,
      detail: string,
      requiredFor: "private-beta" | "public-release" | "external",
      action?: string,
    ) => ({ id, label, status: ok ? "pass" : "block", detail, requiredFor, ...(action ? { action } : {}) });

    const installAssets = byId.get("install.assets");
    const compatibilityRuntime = byId.get("paths.compatibility");
    const piAgents = byId.get("agents.pi");
    const sandbox = byId.get("sandbox.isolation");
    const llmConfigured = Boolean(doctor.config?.llmApiKeyConfigured);
    const privateBetaBlocks = failures.filter((check) => !["config.llm", "sandbox.isolation"].includes(String(check.id ?? "")));
    const packageVersion = String(doctor.install?.packageVersion ?? "unknown");
    const missingAssets = Array.isArray(doctor.install?.missingAssets) ? doctor.install.missingAssets : [];
    const gateStatus = (ok: boolean, warn = false): "pass" | "warn" | "block" => ok ? (warn ? "warn" : "pass") : "block";
    const releaseProof = this.readPublicReleaseProof(packageVersion);
    const llmProof = this.readLiveLlmProof(packageVersion);
    const publicReleaseVerified = releaseProof.ok;
    const liveLlmVerified = llmProof.ok;

    const gates = [
      gate(
        "install.assets",
        "Installed assets",
        installAssets?.status === "pass",
        installAssets?.detail ?? "unknown",
        "private-beta",
        installAssets?.action,
      ),
      gate(
        "frontend.compatibility",
        "Agentix compatibility runtime bundled",
        compatibilityRuntime?.status === "pass",
        compatibilityRuntime?.detail ?? "unknown",
        "private-beta",
        compatibilityRuntime?.action,
      ),
      gate(
        "backend.pi_agents",
        "Powerhouse/Symphony/Pi backend",
        piAgents?.status === "pass",
        piAgents?.detail ?? "unknown",
        "private-beta",
        piAgents?.action,
      ),
      gate(
        "sandbox.isolation",
        "Sandbox isolation",
        sandbox?.status !== "fail",
        sandbox?.detail ?? "unknown",
        "private-beta",
        sandbox?.action,
      ),
      gate(
        "package.version",
        "Versioned package metadata",
        packageVersion !== "unknown",
        packageVersion,
        "public-release",
        packageVersion === "unknown" ? "Ensure package.json is included in the installed Agentix package." : undefined,
      ),
      gate(
        "llm.live_key",
        "Live LLM task verified",
        liveLlmVerified,
        llmProof.ok
          ? `verified by ${llmProof.path}`
          : llmConfigured
            ? llmProof.detail
            : "missing; model-backed tasks will fail until a provider key is configured",
        "public-release",
        liveLlmVerified ? undefined : "Run agentix setup or export AGENTIX_LLM_API_KEY, then run npm run verify:llm -- --out data/release/live-llm-proof.json.",
      ),
      gate(
        "release.publish",
        "Published npm/GitHub release",
        publicReleaseVerified,
        releaseProof.ok
          ? `verified by ${releaseProof.path}`
          : releaseProof.detail,
        "external",
        publicReleaseVerified ? undefined : "Tag a release, publish with provenance, then verify npm install -g and curl install from public URLs.",
      ),
    ].map((item) => item.id === "sandbox.isolation" && item.status === "pass" && sandbox?.status === "warn"
      ? { ...item, status: gateStatus(true, true) }
      : item);
    const privateBetaReady = privateBetaBlocks.length === 0 && missingAssets.length === 0;
    const publicReleaseReady = privateBetaReady && liveLlmVerified && packageVersion !== "unknown" && publicReleaseVerified;

    return {
      status: publicReleaseReady ? "public-release-ready" : privateBetaReady ? "private-beta-ready" : "not-ready",
      privateBetaReady,
      publicReleaseReady,
      generatedAt: new Date().toISOString(),
      gates,
      warnings: warnings.map((check) => ({
        id: check.id,
        detail: check.detail,
        action: check.action,
      })),
      blockers: privateBetaBlocks.map((check) => ({
        id: check.id,
        detail: check.detail,
        action: check.action,
      })),
      externalRequirements: gates
        .filter((item) => (item.requiredFor === "external" || item.requiredFor === "public-release") && item.status !== "pass")
        .map((item) => ({
          id: item.id,
          detail: item.detail,
          action: item.action,
        })),
      doctorStatus: doctor.status ?? "unknown",
      releaseProof,
      llmProof,
    };
  }

  private readLiveLlmProof(packageVersion: string): {
    ok: boolean;
    path: string;
    detail: string;
    verifiedAt?: string;
  } {
    const proofPath = process.env.AGENTIX_LLM_PROOF
      || join(PATHS.dataDir, "release", "live-llm-proof.json");
    if (!existsSync(proofPath)) {
      return {
        ok: false,
        path: proofPath,
        detail: `missing proof file: ${proofPath}`,
      };
    }
    try {
      const proof = JSON.parse(readFileSync(proofPath, "utf-8")) as {
        ok?: boolean;
        package?: string;
        version?: string;
        provider?: string;
        model?: string;
        endpoint?: string;
        responseChars?: number;
        verifiedAt?: string;
      };
      if (!proof.ok) {
        return { ok: false, path: proofPath, detail: "proof file does not mark ok=true" };
      }
      if (proof.package !== PACKAGE_METADATA.name) {
        return { ok: false, path: proofPath, detail: `proof package mismatch: ${String(proof.package)}` };
      }
      if (proof.version !== packageVersion) {
        return { ok: false, path: proofPath, detail: `proof version mismatch: ${String(proof.version)} != ${packageVersion}` };
      }
      if (!proof.provider || !proof.model || !proof.endpoint) {
        return { ok: false, path: proofPath, detail: "proof missing provider/model/endpoint details" };
      }
      if (!proof.responseChars || proof.responseChars <= 0) {
        return { ok: false, path: proofPath, detail: "proof did not record a live model response" };
      }
      return {
        ok: true,
        path: proofPath,
        detail: `${proof.provider}/${proof.model} verified`,
        verifiedAt: proof.verifiedAt,
      };
    } catch (err) {
      return {
        ok: false,
        path: proofPath,
        detail: `invalid proof file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private readPublicReleaseProof(packageVersion: string): {
    ok: boolean;
    path: string;
    detail: string;
    verifiedAt?: string;
  } {
    const proofPath = process.env.AGENTIX_PUBLIC_RELEASE_PROOF
      || join(PATHS.dataDir, "release", "public-release-proof.json");
    if (!existsSync(proofPath)) {
      return {
        ok: false,
        path: proofPath,
        detail: `missing proof file: ${proofPath}`,
      };
    }
    try {
      const proof = JSON.parse(readFileSync(proofPath, "utf-8")) as {
        ok?: boolean;
        package?: string;
        version?: string;
        installerDryRun?: boolean;
        verifiedAt?: string;
        release?: { sha256?: string; manifestUrl?: string; tarballUrl?: string };
        npm?: { attestations?: { url?: string; predicateType?: string; provenance?: boolean } };
        npmInstall?: { agentixVersion?: string; helpChecked?: boolean };
      };
      if (!proof.ok) {
        return { ok: false, path: proofPath, detail: "proof file does not mark ok=true" };
      }
      if (proof.package !== PACKAGE_METADATA.name) {
        return { ok: false, path: proofPath, detail: `proof package mismatch: ${String(proof.package)}` };
      }
      if (proof.version !== packageVersion) {
        return { ok: false, path: proofPath, detail: `proof version mismatch: ${String(proof.version)} != ${packageVersion}` };
      }
      if (!proof.release?.sha256 || !proof.release.manifestUrl || !proof.release.tarballUrl) {
        return { ok: false, path: proofPath, detail: "proof missing release manifest/tarball/SHA256 details" };
      }
      if (!proof.npm) {
        return { ok: false, path: proofPath, detail: "proof missing npm registry metadata" };
      }
      if (!proof.npm.attestations?.url || proof.npm.attestations.provenance !== true) {
        return { ok: false, path: proofPath, detail: "proof missing npm provenance attestation verification" };
      }
      if (!proof.npm.attestations.predicateType?.startsWith("https://slsa.dev/provenance/")) {
        return { ok: false, path: proofPath, detail: "proof missing SLSA provenance predicate" };
      }
      if (!proof.npmInstall?.agentixVersion || !proof.npmInstall.helpChecked) {
        return { ok: false, path: proofPath, detail: "proof missing npm global install verification" };
      }
      if (!proof.installerDryRun) {
        return { ok: false, path: proofPath, detail: "proof did not verify installer dry-run" };
      }
      return {
        ok: true,
        path: proofPath,
        detail: `${proof.package}@${proof.version} verified`,
        verifiedAt: proof.verifiedAt,
      };
    } catch (err) {
      return {
        ok: false,
        path: proofPath,
        detail: `invalid proof file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  createSupportBundle(): Record<string, unknown> {
    this.powerhouse.start();
    const bundleId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const bundleDir = join(PATHS.dataDir, "support", `bundle-${bundleId}`);
    mkdirSync(bundleDir, { recursive: true });

    const config = loadConfig();
    const knownSecrets = Array.from(new Set([
      config.llmApiKey,
      config.sessionToken,
      ...Object.entries(process.env)
        .filter(([name, value]) =>
          /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name) && Boolean(value && value.length >= 8),
        )
        .map(([, value]) => value),
    ].filter((value): value is string => Boolean(value)))).sort((left, right) => right.length - left.length);
    const redactText = (value: string): string => {
      let redacted = value;
      for (const secret of knownSecrets) redacted = redacted.split(secret).join("[redacted]");
      return redacted
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [redacted]")
        .replace(/(https?:\/\/[^\s/:@]+:)[^\s/@]+@/gi, "$1[redacted]@");
    };
    const redactValue = (value: unknown, key = ""): unknown => {
      if (
        /(?:api.?key|token|secret|password|credential|authorization|cookie|private.?key)$/i.test(key) &&
        typeof value === "string"
      ) {
        return value ? "[redacted]" : value;
      }
      if (typeof value === "string") return redactText(value);
      if (Array.isArray(value)) return value.map((item) => redactValue(item));
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .map(([name, item]) => [name, redactValue(item, name)]),
        );
      }
      return value;
    };
    const writeJson = (name: string, value: unknown): string => {
      const file = join(bundleDir, name);
      writeFileSync(file, JSON.stringify(redactValue(value), null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
      return file;
    };

    const safeConfig = {
      ...config,
      llmApiKey: config.llmApiKey ? "[redacted]" : null,
      sessionToken: config.sessionToken ? "[redacted]" : null,
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
    this.copyDirectory(PATHS.logsDir, join(bundleDir, "logs"), redactText);

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
      model?: string;
      provider?: string;
      baseUrl?: string;
      toolsets?: unknown;
      skills?: string[];
      signal?: AbortSignal;
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

  private copyDirectory(
    sourceDir: string,
    targetDir: string,
    transform: (value: string) => string,
  ): void {
    if (!existsSync(sourceDir)) return;
    mkdirSync(targetDir, { recursive: true });
    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = join(sourceDir, entry.name);
      const targetPath = join(targetDir, entry.name);
      if (entry.isDirectory()) {
        this.copyDirectory(sourcePath, targetPath, transform);
      } else if (entry.isFile()) {
        writeFileSync(targetPath, transform(readFileSync(sourcePath, "utf-8")), {
          encoding: "utf-8",
          mode: 0o600,
        });
      }
    }
  }
}
