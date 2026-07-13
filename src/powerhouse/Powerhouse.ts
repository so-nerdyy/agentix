import { randomUUID } from "node:crypto";
import { AuditLog } from "../audit/AuditLog.js";
import { EventBus } from "../config/EventBus.js";
import { PATHS } from "../config/paths.js";
import { loadConfig } from "../config/index.js";
import { BashAgent } from "../pi/BashAgent.js";
import { CodeAgent } from "../pi/CodeAgent.js";
import { AgentProfileStore } from "../pi/AgentProfileStore.js";
import { CommandAgent } from "../pi/CommandAgent.js";
import { ConversationAgent } from "../pi/ConversationAgent.js";
import { DelegatedConversationAgent } from "../pi/DelegatedConversationAgent.js";
import { SandboxAgent } from "../pi/SandboxAgent.js";
import { HealingEngine } from "../healing/HealingEngine.js";
import { MemoryStore } from "../memory/MemoryStore.js";
import { PlanStore } from "../symphony/PlanStore.js";
import type { StoredPlanExecution } from "../symphony/PlanStore.js";
import { SymphonyEngine } from "../symphony/SymphonyEngine.js";
import type { PlanStep, SymphonyResult } from "../symphony/types.js";
import { ApprovalWorkflow } from "./ApprovalWorkflow.js";
import { PIAgentRegistry } from "./PIAgentRegistry.js";
import { SessionCoordinator } from "./SessionCoordinator.js";
import { TaskQueue } from "./TaskQueue.js";
import { TaskStore } from "./TaskStore.js";
import { SkillRegistry } from "./SkillRegistry.js";
import type { Session, Task, TaskAction, TaskResult } from "./types.js";

export interface ExecuteStimulusOptions {
  stimulus: string;
  sessionId?: string;
  onDelta?: (delta: string) => void;
  model?: string;
  provider?: string;
  baseUrl?: string;
  toolsets?: unknown;
  skills?: string[];
  signal?: AbortSignal;
}

export interface ExecuteStimulusResult {
  response: string;
  sessionId: string;
  taskIds: string[];
  status: "complete" | "awaiting-approval" | "failed" | "cancelled";
}

export class Powerhouse {
  readonly sessions: SessionCoordinator;
  readonly queue: TaskQueue;
  readonly approvals: ApprovalWorkflow;
  readonly agents: PIAgentRegistry;
  readonly memory: MemoryStore;
  readonly healing: HealingEngine;
  readonly symphony: SymphonyEngine;
  readonly planStore: PlanStore;
  readonly taskStore: TaskStore;
  readonly audit: AuditLog;
  readonly agentProfiles: AgentProfileStore;
  readonly skills: SkillRegistry;
  private started = false;
  private stopping = false;
  private recoveryScheduled = false;
  private readonly taskControllers = new Map<string, AbortController>();

  constructor(opts: {
    sessions?: SessionCoordinator;
    queue?: TaskQueue;
    approvals?: ApprovalWorkflow;
    agents?: PIAgentRegistry;
    memory?: MemoryStore;
    healing?: HealingEngine;
    symphony?: SymphonyEngine;
    planStore?: PlanStore;
    taskStore?: TaskStore;
    audit?: AuditLog;
    agentProfiles?: AgentProfileStore;
    skills?: SkillRegistry;
  } = {}) {
    this.sessions = opts.sessions ?? new SessionCoordinator();
    this.queue = opts.queue ?? new TaskQueue();
    this.approvals = opts.approvals ?? new ApprovalWorkflow();
    this.agents = opts.agents ?? new PIAgentRegistry();
    this.memory = opts.memory ?? new MemoryStore();
    this.healing = opts.healing ?? new HealingEngine();
    this.symphony = opts.symphony ?? new SymphonyEngine();
    this.planStore = opts.planStore ?? new PlanStore();
    this.taskStore = opts.taskStore ?? new TaskStore();
    this.audit = opts.audit ?? new AuditLog();
    this.agentProfiles = opts.agentProfiles ?? new AgentProfileStore();
    this.skills = opts.skills ?? new SkillRegistry();
    this.approvals.setTimeoutHandler((task, reason) => {
      this.rejectExpiredApproval(task.id, reason);
    });
  }

  start(opts: { recover?: boolean } = {}): void {
    if (this.started) return;
    this.stopping = false;
    const recover = opts.recover ?? true;
    EventBus.emit("powerhouse:starting", {});
    const recoveredTasks = recover
      ? this.taskStore.recoverOpen().map((task) => {
          if (task.status === "running") {
            task.status = "queued";
            task.startedAt = undefined;
            this.taskStore.upsert(task);
          }
          return task;
        })
      : [];
    const recoveredPlans = recover
      ? this.planStore.list().filter((execution) => execution.status === "running")
      : [];
    if (recover) {
      this.sessions.recover();
      this.queue.hydrate(recoveredTasks);
    }
    this.registerDefaultAgents();
    for (const task of recoveredTasks) {
      if (task.status === "awaiting-approval") {
        this.approvals.request(task);
      }
    }
    this.agents.startHealthMonitor();
    this.started = true;
    this.audit.record({
      type: "powerhouse.started",
      actor: "system",
      data: { recoveredTasks: recoveredTasks.length, recoveredPlans: recoveredPlans.length },
    });
    EventBus.emit("powerhouse:started", {});
    if (recoveredTasks.length > 0 || recoveredPlans.length > 0) {
      const recoveredPlanIds = new Set(recoveredPlans.map((execution) => execution.plan.id));
      const standaloneTasks = recoveredTasks.filter((task) =>
        !task.planId || !recoveredPlanIds.has(task.planId),
      );
      const recovery = setTimeout(() => {
        void this.resumeRecoveredState(recoveredPlans, standaloneTasks).catch((error) => {
          this.audit.record({
            type: "recovery.failed",
            actor: "system",
            data: { error: error instanceof Error ? error.message : String(error) },
          });
        });
      }, 0);
      recovery.unref?.();
    }
  }

  stop(): void {
    if (!this.started) return;
    this.stopping = true;
    EventBus.emit("powerhouse:stopping", {});
    for (const [taskId, controller] of this.taskControllers) {
      const task = this.queue.get(taskId);
      if (task?.status === "running") {
        task.status = "queued";
        task.startedAt = undefined;
        task.finishedAt = undefined;
        task.error = undefined;
        this.queue.requeue(task);
        this.taskStore.upsert(task);
        this.audit.record({
          type: "task.interrupted",
          actor: "system",
          subjectId: task.id,
          data: { sessionId: task.sessionId, kind: task.kind, reason: "powerhouse stopped" },
        });
      }
      controller.abort(new Error("Powerhouse stopped"));
    }
    this.taskControllers.clear();
    this.approvals.shutdown();
    this.agents.shutdown();
    this.started = false;
    this.audit.record({ type: "powerhouse.stopped", actor: "system", data: {} });
    EventBus.emit("powerhouse:stopped", {});
  }

  listSessions(): Session[] {
    this.sessions.recover();
    return this.sessions.list();
  }

  createSession(metadata: Record<string, unknown> = {}): Session {
    this.start();
    const session = this.sessions.create(metadata);
    this.audit.record({
      type: "session.created",
      actor: "user",
      subjectId: session.id,
      data: { sessionId: session.id, metadata },
    });
    EventBus.emit("session:create", { sessionId: session.id });
    return session;
  }

  closeSession(id: string): void {
    const session = this.sessions.get(id);
    this.sessions.close(id);
    if (session) {
      this.audit.record({
        type: "session.closed",
        actor: "user",
        subjectId: id,
        data: {
          sessionId: id,
          metadata: session.metadata,
          status: "complete",
        },
      });
    }
    EventBus.emit("session:close", { sessionId: id });
  }

  deleteSession(id: string): { ok: boolean; error?: string } {
    this.start();
    const session = this.sessions.get(id);
    if (!session) return { ok: false, error: `unknown session: ${id}` };
    const openTasks = this.listTasks(id).filter((task) =>
      ["queued", "running", "awaiting-approval"].includes(task.status),
    );
    if (session.pendingTaskIds.length > 0 || openTasks.length > 0) {
      return { ok: false, error: `session has active work: ${id}` };
    }
    if (!this.sessions.delete(id)) return { ok: false, error: `unknown session: ${id}` };
    this.audit.record({
      type: "session.deleted",
      actor: "user",
      subjectId: id,
      data: { sessionId: id, metadata: session.metadata },
    });
    EventBus.emit("session:close", { sessionId: id });
    return { ok: true };
  }

  renameSession(id: string, title: string): Session | undefined {
    this.start();
    return this.sessions.updateMetadata(id, { title });
  }

  undoSession(id: string): { ok: boolean; removed?: number; messages?: Session["messages"]; error?: string } {
    this.start();
    const session = this.sessions.get(id);
    if (!session) return { ok: false, error: `unknown session: ${id}` };
    const openTasks = this.listTasks(id).filter((task) =>
      ["queued", "running", "awaiting-approval"].includes(task.status),
    );
    if (session.pendingTaskIds.length > 0 || openTasks.length > 0) {
      return { ok: false, error: `session has active work: ${id}` };
    }
    const result = this.sessions.undoLastTurn(id);
    if (!result) return { ok: false, error: `unknown session: ${id}` };
    this.audit.record({
      type: "session.undone",
      actor: "user",
      subjectId: id,
      data: { sessionId: id, removed: result.removed },
    });
    return { ok: true, ...result };
  }

  replaceSessionHistory(
    id: string,
    messages: Array<Omit<Session["messages"][number], "ts"> & { ts?: number }>,
    reason: string,
  ): { ok: boolean; messages?: Session["messages"]; error?: string } {
    this.start();
    const session = this.sessions.get(id);
    if (!session) return { ok: false, error: `unknown session: ${id}` };
    const openTasks = this.listTasks(id).filter((task) =>
      ["queued", "running", "awaiting-approval"].includes(task.status),
    );
    if (session.pendingTaskIds.length > 0 || openTasks.length > 0) {
      return { ok: false, error: `session has active work: ${id}` };
    }
    const replaced = this.sessions.replaceMessages(id, messages);
    if (!replaced) return { ok: false, error: `unknown session: ${id}` };
    this.audit.record({
      type: "session.history_replaced",
      actor: "user",
      subjectId: id,
      data: { sessionId: id, reason, messageCount: replaced.length },
    });
    return { ok: true, messages: replaced };
  }

  branchSession(id: string, title?: string): { ok: boolean; session?: Session; error?: string } {
    this.start();
    const source = this.sessions.get(id);
    if (!source) return { ok: false, error: `unknown session: ${id}` };
    if (source.messages.length === 0) return { ok: false, error: `session has no history: ${id}` };
    const branch = this.createSession({
      ...source.metadata,
      title: title?.trim() || `${String(source.metadata.title || "Session")} (branch)`,
      parentSessionId: id,
      source: "agentix-session-branch",
    });
    this.sessions.replaceMessages(branch.id, source.messages);
    const persisted = this.sessions.get(branch.id)!;
    this.audit.record({
      type: "session.branched",
      actor: "user",
      subjectId: branch.id,
      data: { sessionId: branch.id, parentSessionId: id },
    });
    return { ok: true, session: persisted };
  }

  removeAgentProfile(id: string) {
    this.start({ recover: false });
    const profile = this.agentProfiles.remove(id);
    if (profile) this.agents.unregister(id);
    return profile;
  }

  listTasks(sessionId?: string): Task[] {
    return this.taskStore.list(sessionId);
  }

  async retryPlan(planId: string): Promise<SymphonyResult | null> {
    this.start();
    const execution = this.planStore.get(planId);
    if (!execution || execution.status !== "failed") return null;
    return this.continuePlanExecution(execution, {
      reuseOpenTasks: false,
      reason: "manual-retry",
    });
  }

  cancelPlan(
    planId: string,
    reason = "cancelled by user",
    actor: "user" | "system" = "user",
  ): { ok: boolean; status?: StoredPlanExecution["status"]; taskIds: string[]; error?: string } {
    this.start();
    const execution = this.planStore.get(planId);
    if (!execution) return { ok: false, taskIds: [], error: `unknown plan: ${planId}` };
    if (execution.status === "cancelled") {
      return { ok: true, status: "cancelled", taskIds: [] };
    }
    if (["complete", "failed"].includes(execution.status)) {
      return {
        ok: false,
        status: execution.status,
        taskIds: [],
        error: `plan cannot be cancelled from ${execution.status}: ${planId}`,
      };
    }

    const relatedTasks = this.taskStore
      .list(execution.sessionId)
      .filter((task) => task.planId === planId);
    const cancelledTaskIds: string[] = [];
    for (const task of relatedTasks) {
      if (!["queued", "running", "awaiting-approval"].includes(task.status)) continue;
      if (this.cancelTask(task.id, reason, actor)) cancelledTaskIds.push(task.id);
    }

    this.recordPlanExecution(
      execution.plan,
      execution.sessionId,
      Array.from(new Set([...execution.taskIds, ...relatedTasks.map((task) => task.id)])),
      "cancelled",
    );
    this.audit.record({
      type: "plan.cancelled",
      actor,
      subjectId: planId,
      data: { sessionId: execution.sessionId, reason, taskIds: cancelledTaskIds },
    });
    return { ok: true, status: "cancelled", taskIds: cancelledTaskIds };
  }

  listApprovals(): Task[] {
    this.start();
    return this.approvals.listPending();
  }

  async approve(taskId: string): Promise<TaskResult> {
    this.start();
    const task = this.queue.get(taskId);
    if (!task) return { ok: false, error: `unknown task: ${taskId}` };
    if (!this.approvals.approve(taskId)) {
      return { ok: false, error: `task is not awaiting approval: ${taskId}` };
    }
    this.queue.transition(task, "running");
    this.taskStore.upsert(task);
    this.audit.record({
      type: "approval.approved",
      actor: "user",
      subjectId: task.id,
      data: { sessionId: task.sessionId, kind: task.kind },
    });
    EventBus.emit("task:running", { taskId: task.id, sessionId: task.sessionId });
    const approvedResult = await this.runTask(task);
    if (!approvedResult.ok) return approvedResult;

    const continuation = await this.resumePlanAfterApproval(task);
    if (!continuation) return approvedResult;

    return {
      ok: continuation.status === "complete",
      output: {
        approvedTaskId: task.id,
        approvedOutput: approvedResult.output,
        continuation,
      },
      error: continuation.status === "complete" ? undefined : continuation.response,
    };
  }

  reject(taskId: string, reason?: string): boolean {
    this.start();
    const task = this.queue.get(taskId);
    if (!task) return false;
    const rejected = this.approvals.reject(taskId, reason);
    if (rejected && task.status === "awaiting-approval") {
      this.queue.transition(task, "rejected");
      task.error = reason ?? "rejected";
      this.taskStore.upsert(task);
      this.sessions.removePendingTask(task.sessionId, task.id);
      this.audit.record({
        type: "approval.rejected",
        actor: "user",
        subjectId: task.id,
        data: { sessionId: task.sessionId, reason: reason ?? null },
      });
      this.cancelPlanAfterRejection(task, task.error, "user");
    }
    return rejected;
  }

  private rejectExpiredApproval(taskId: string, reason: string): boolean {
    const task = this.queue.get(taskId);
    if (!task || task.status !== "awaiting-approval") return false;
    this.queue.transition(task, "rejected");
    task.error = reason;
    this.taskStore.upsert(task);
    this.sessions.removePendingTask(task.sessionId, task.id);
    this.audit.record({
      type: "approval.timeout_rejected",
      actor: "system",
      subjectId: task.id,
      data: { sessionId: task.sessionId, kind: task.kind, reason },
    });
    this.cancelPlanAfterRejection(task, reason, "system");
    EventBus.emit("task:failed", {
      taskId: task.id,
      sessionId: task.sessionId,
      error: reason,
    });
    return true;
  }

  async controlTask(taskId: string, action: TaskAction): Promise<TaskResult> {
    this.start();
    const task = this.queue.get(taskId) ?? this.hydrateStoredTask(taskId);
    if (!task) return { ok: false, error: `unknown task: ${taskId}` };
    if (action === "cancel") {
      const cancelled = this.cancelTask(taskId, "cancelled by user", "user");
      if (!cancelled) return { ok: false, error: `task cannot be cancelled: ${taskId}` };
      if (cancelled.planId) {
        this.cancelPlan(cancelled.planId, "plan cancelled after task cancellation", "user");
      }
      return { ok: true, output: { action, taskId: cancelled.id, status: cancelled.status } };
    }
    if (action === "retry") {
      const retried = this.queue.retry(taskId);
      if (!retried) return { ok: false, error: `task cannot be retried: ${taskId}` };
      this.taskStore.upsert(retried);
      this.audit.record({
        type: "task.retried",
        actor: "user",
        subjectId: retried.id,
        data: { sessionId: retried.sessionId, kind: retried.kind },
      });
      EventBus.emit("task:queued", {
        taskId: retried.id,
        sessionId: retried.sessionId,
        kind: retried.kind,
      });
      const result = await this.dispatchQueuedTask(retried);
      return {
        ok: result.ok,
        output: { action, taskId: retried.id, status: retried.status, result: result.output ?? null },
        error: result.error,
      };
    }
    if (action === "restart") {
      const restarted = this.queue.retry(taskId) ?? task;
      restarted.status = "queued";
      restarted.startedAt = undefined;
      restarted.finishedAt = undefined;
      restarted.error = undefined;
      this.queue.requeue(restarted);
      this.taskStore.upsert(restarted);
      this.audit.record({
        type: "task.restarted",
        actor: "user",
        subjectId: restarted.id,
        data: { sessionId: restarted.sessionId, kind: restarted.kind },
      });
      EventBus.emit("task:queued", {
        taskId: restarted.id,
        sessionId: restarted.sessionId,
        kind: restarted.kind,
      });
      const result = await this.dispatchQueuedTask(restarted);
      return {
        ok: result.ok,
        output: { action, taskId: restarted.id, status: restarted.status, result: result.output ?? null },
        error: result.error,
      };
    }
    return { ok: false, error: `unsupported task action: ${action}` };
  }

  private hydrateStoredTask(taskId: string): Task | undefined {
    const task = this.taskStore.get(taskId);
    if (!task) return undefined;
    this.queue.upsert(task);
    return task;
  }

  async executeStimulus(opts: ExecuteStimulusOptions): Promise<ExecuteStimulusResult> {
    this.start();
    const session = this.ensureSession(opts.sessionId);
    if (opts.model || opts.provider || opts.baseUrl || opts.toolsets || opts.skills) {
      this.sessions.updateMetadata(session.id, {
        model: opts.model ?? session.metadata.model ?? null,
        provider: opts.provider ?? session.metadata.provider ?? null,
        baseUrl: opts.baseUrl ?? session.metadata.baseUrl ?? null,
        toolsets: opts.toolsets ?? session.metadata.toolsets ?? null,
        skills: opts.skills ?? session.metadata.skills ?? null,
      });
    }
    const taskIds: string[] = [];
    const emitProgress = (message: string) => opts.onDelta?.(`[agentix] ${message}\n`);

    this.sessions.appendMessage(session.id, { role: "user", content: opts.stimulus });
    this.memory.add({
      sessionId: session.id,
      role: "user",
      content: opts.stimulus,
      tags: ["stimulus"],
    });

    emitProgress("Planning task with Symphony...");
    let plan: SymphonyResult["plan"];
    try {
      plan = await this.symphony.createPlan(opts.stimulus, opts.signal);
    } catch (error) {
      if (!opts.signal?.aborted) throw error;
      const response = "Agentix execution cancelled during planning.";
      this.sessions.appendMessage(session.id, { role: "assistant", content: response });
      this.memory.add({
        sessionId: session.id,
        role: "assistant",
        content: response,
        tags: ["cancelled"],
      });
      this.audit.record({
        type: "stimulus.cancelled",
        actor: "user",
        subjectId: session.id,
        data: { phase: "planning", taskIds: [] },
      });
      return { response, sessionId: session.id, taskIds, status: "cancelled" };
    }
    this.recordPlanExecution(plan, session.id, taskIds, "running");
    const streamModelOutput = plan.steps.length === 1 &&
      ["user-message", "luna-message", "terra-message"].includes(plan.steps[0]!.kind);
    let streamedModelResponse = "";
    const rawResult = await this.symphony.runPlan(plan, {
      executeStep: async (step, planId) => {
        if (opts.model || opts.provider || opts.baseUrl || opts.toolsets || opts.skills) {
          step = {
            ...step,
            payload: {
              ...step.payload,
              execution: {
                model: opts.model,
                provider: opts.provider,
                baseUrl: opts.baseUrl,
                toolsets: opts.toolsets,
                skills: opts.skills,
              },
            },
          };
        }
        emitProgress(`Running step ${step.id} (${step.kind})...`);
        const { task, result } = await this.executeStep(
          session.id,
          step,
          planId,
          opts.signal,
          streamModelOutput
            ? (delta) => {
                streamedModelResponse += delta;
                opts.onDelta?.(delta);
              }
            : undefined,
        );
        if (streamedModelResponse && !/\s$/.test(streamedModelResponse)) {
          opts.onDelta?.("\n");
        }
        taskIds.push(task.id);
        this.recordPlanExecution(plan, session.id, taskIds, "running");
        if (result.ok) {
          emitProgress(`Step ${step.id} completed as ${task.id}.`);
        } else if (result.error?.includes("approval required")) {
          emitProgress(`Step ${step.id} is waiting for approval as ${task.id}.`);
        } else {
          emitProgress(`Step ${step.id} failed as ${task.id}: ${result.error ?? "unknown error"}`);
        }
        return { taskId: task.id, result };
      },
      recoverStep: (step, failure) => this.recoverStep(step, failure),
    }, {
      signal: opts.signal,
    });

    const result = this.resultWithPersistedCancellation(rawResult);
    const status = opts.signal?.aborted ? "cancelled" : result.status;
    this.recordPlanExecution(result.plan, session.id, taskIds, this.stopping ? "running" : status);

    const response = status === "awaiting-approval"
      ? this.approvalResponse(taskIds)
      : status === "cancelled"
        ? "Agentix execution cancelled."
        : result.response;

    emitProgress(`Execution ${status}.`);
    if (!streamedModelResponse || streamedModelResponse.trim() !== response.trim()) {
      for (const chunk of this.streamChunks(response)) {
        opts.onDelta?.(chunk);
      }
    }

    this.memory.add({
      sessionId: session.id,
      role: "assistant",
      content: response,
      tags: [status],
      taskId: taskIds[taskIds.length - 1],
    });

    this.sessions.appendMessage(session.id, { role: "assistant", content: response });
    this.audit.record({
      type: "stimulus.executed",
      actor: "user",
      subjectId: session.id,
      data: {
        status,
        taskIds,
        planId: result.plan.id,
        planner: result.plan.planner,
        reasoning: result.plan.reasoning ?? null,
        fallbackReason: result.plan.fallbackReason ?? null,
      },
    });

    return { response, sessionId: session.id, taskIds, status };
  }

  private async executeStep(
    sessionId: string,
    step: PlanStep,
    planId: string,
    signal?: AbortSignal,
    onDelta?: (delta: string) => void,
  ): Promise<{ task: Task; result: TaskResult }> {
    const task = this.createTask(sessionId, step, planId);
    this.queue.enqueue(task);
    this.taskStore.upsert(task);
    this.sessions.addPendingTask(sessionId, task.id);
    EventBus.emit("task:queued", { taskId: task.id, sessionId, kind: task.kind });

    if (signal?.aborted) {
      const cancelled = this.cancelTask(task.id, "cancelled by interrupted request", "user") ?? task;
      return { task: cancelled, result: { ok: false, error: "cancelled" } };
    }

    const running = this.queue.dequeueTask(task.id);
    if (!running) {
      return { task, result: { ok: false, error: "failed to dequeue task" } };
    }

    EventBus.emit("task:running", { taskId: running.id, sessionId });
    this.taskStore.upsert(running);

    if (running.requiresApproval) {
      this.queue.transition(running, "awaiting-approval");
      this.taskStore.upsert(running);
      this.approvals.request(running);
      this.audit.record({
        type: "approval.requested",
        actor: "system",
        subjectId: running.id,
        data: { sessionId, kind: running.kind, payload: running.payload },
      });
      return {
        task: running,
        result: {
          ok: false,
          error: `approval required for task ${running.id}`,
          output: { awaitingApproval: true, taskId: running.id },
        },
      };
    }

    return { task: running, result: await this.runTask(running, signal, onDelta) };
  }

  private recoverStep(
    step: PlanStep,
    failure: { taskId: string; error: string; attempt: number; result: TaskResult },
  ): PlanStep | null {
    const procedure = this.healing.useProcedureFor(failure.error);
    if (!procedure) return null;

    const guidance = [
      `Promoted healing procedure ${procedure.id}: ${procedure.summary}`,
      `Previous attempt ${failure.attempt} failed with: ${failure.error}`,
    ].join("\n");
    const payload: Record<string, unknown> = {
      ...step.payload,
      healingProcedureId: procedure.id,
      healingAdvice: guidance,
    };

    if (["user-message", "luna-message", "terra-message"].includes(step.kind)) {
      const existingContext = typeof payload.context === "string" ? payload.context.trim() : "";
      payload.context = [existingContext, guidance].filter(Boolean).join("\n\n");
    }

    this.audit.record({
      type: "healing.procedure_applied",
      actor: "system",
      subjectId: procedure.id,
      data: {
        taskId: failure.taskId,
        stepId: step.id,
        kind: step.kind,
        fingerprint: procedure.fingerprint,
        attempt: failure.attempt,
      },
    });

    return {
      ...step,
      payload,
    };
  }

  private async resumePlanAfterApproval(task: Task): Promise<SymphonyResult | null> {
    if (!task.planId || !task.stepId) return null;
    const execution = this.planStore.get(task.planId);
    if (!execution || execution.status !== "awaiting-approval") return null;

    const completedStepIds = new Set(
      this.taskStore
        .list(task.sessionId)
        .filter((item) => item.planId === task.planId && item.stepId && item.status === "complete")
        .map((item) => item.stepId!),
    );

    if (!completedStepIds.has(task.stepId)) return null;
    const hasRemainingSteps = execution.plan.steps.some((step) => !completedStepIds.has(step.id));
    if (!hasRemainingSteps) {
      this.recordPlanExecution(execution.plan, task.sessionId, execution.taskIds, "complete");
      return null;
    }

    const continuationTaskIds: string[] = [];
    const result = await this.symphony.runPlan(execution.plan, {
      executeStep: async (step, planId) => {
        const { task: nextTask, result: nextResult } = await this.executeStep(task.sessionId, step, planId);
        continuationTaskIds.push(nextTask.id);
        return { taskId: nextTask.id, result: nextResult };
      },
      recoverStep: (step, failure) => this.recoverStep(step, failure),
    }, {
      completedStepIds,
    });

    const taskIds = [...execution.taskIds, ...continuationTaskIds];
    this.recordPlanExecution(
      result.plan,
      task.sessionId,
      taskIds,
      this.stopping ? "running" : result.status,
    );
    this.audit.record({
      type: "plan.resumed_after_approval",
      actor: "system",
      subjectId: result.plan.id,
      data: {
        approvedTaskId: task.id,
        sessionId: task.sessionId,
        status: result.status,
        continuationTaskIds,
      },
    });

    if (result.response) {
      this.sessions.appendMessage(task.sessionId, { role: "assistant", content: result.response });
      this.memory.add({
        sessionId: task.sessionId,
        role: "assistant",
        content: result.response,
        tags: ["approval-continuation", result.status],
        taskId: continuationTaskIds[continuationTaskIds.length - 1] ?? task.id,
      });
    }

    return result;
  }

  private recordPlanExecution(
    plan: SymphonyResult["plan"],
    sessionId: string,
    taskIds: string[],
    status: StoredPlanExecution["status"],
  ): void {
    const current = this.planStore.get(plan.id);
    const effectiveStatus = current?.status === "cancelled" ? "cancelled" : status;
    this.planStore.upsert({ plan, sessionId, taskIds, status: effectiveStatus });
  }

  private resultWithPersistedCancellation(result: SymphonyResult): SymphonyResult {
    if (this.planStore.get(result.plan.id)?.status !== "cancelled") return result;
    return {
      ...result,
      ok: false,
      status: "cancelled",
      response: "Agentix execution cancelled.",
      error: "cancelled",
    };
  }

  private async dispatchQueuedTask(task: Task): Promise<TaskResult> {
    const running = this.queue.dequeueTask(task.id);
    if (!running) {
      return { ok: false, error: `failed to dispatch queued task: ${task.id}` };
    }

    EventBus.emit("task:running", { taskId: running.id, sessionId: running.sessionId });
    this.taskStore.upsert(running);

    if (running.requiresApproval) {
      this.queue.transition(running, "awaiting-approval");
      this.taskStore.upsert(running);
      this.approvals.request(running);
      this.audit.record({
        type: "approval.requested",
        actor: "system",
        subjectId: running.id,
        data: { sessionId: running.sessionId, kind: running.kind, payload: running.payload, control: true },
      });
      return {
        ok: true,
        output: { awaitingApproval: true, taskId: running.id },
      };
    }

    return this.runTask(running);
  }

  private async runTask(
    task: Task,
    externalSignal?: AbortSignal,
    onDelta?: (delta: string) => void,
  ): Promise<TaskResult> {
    const agent = this.agents.pickFor(task);
    if (!agent) {
      const error = `no Pi agent registered for ${task.kind}`;
      this.failTask(task, error);
      return { ok: false, error };
    }

    const controller = new AbortController();
    this.taskControllers.set(task.id, controller);
    const onExternalAbort = () => {
      this.cancelTask(task.id, "cancelled by interrupted request", "user");
    };
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    if (externalSignal?.aborted) onExternalAbort();
    let result: TaskResult;
    try {
      if (this.taskIsCancelled(task)) {
        return { ok: false, error: task.error ?? "cancelled" };
      }
      result = await agent.execute(task, { signal: controller.signal, onDelta });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.stopping && controller.signal.aborted) {
        return { ok: false, error: "interrupted by shutdown" };
      }
      if (this.taskIsCancelled(task)) {
        return { ok: false, error: task.error ?? "cancelled" };
      }
      this.failTask(task, message);
      return { ok: false, error: message };
    } finally {
      externalSignal?.removeEventListener("abort", onExternalAbort);
      if (this.taskControllers.get(task.id) === controller) {
        this.taskControllers.delete(task.id);
      }
    }

    if (this.taskIsCancelled(task)) {
      return { ok: false, error: task.error ?? "cancelled", output: result.output };
    }
    if (this.stopping && controller.signal.aborted) {
      return { ok: false, error: "interrupted by shutdown", output: result.output };
    }
    task.result = result.output;
    task.error = result.error;

    if (result.ok) {
      const procedureId = typeof task.payload.healingProcedureId === "string"
        ? task.payload.healingProcedureId
        : null;
      if (procedureId) {
        this.healing.recordProcedureOutcome(procedureId, true);
        this.audit.record({
          type: "healing.procedure_succeeded",
          actor: "system",
          subjectId: procedureId,
          data: { taskId: task.id, sessionId: task.sessionId, kind: task.kind },
        });
      }
      this.queue.transition(task, "complete");
      this.taskStore.upsert(task);
      this.sessions.removePendingTask(task.sessionId, task.id);
      this.audit.record({
        type: "task.completed",
        actor: "system",
        subjectId: task.id,
        data: { sessionId: task.sessionId, kind: task.kind },
      });
      EventBus.emit("task:complete", {
        taskId: task.id,
        sessionId: task.sessionId,
        result: result.output,
      });
      return result;
    }

    this.failTask(task, result.error ?? "Pi agent failed");
    return result;
  }

  private cancelTask(taskId: string, reason: string, actor: "user" | "system"): Task | undefined {
    const task = this.queue.get(taskId);
    if (task?.status === "awaiting-approval") this.approvals.reject(taskId, reason);
    const cancelled = this.queue.cancel(taskId);
    if (!cancelled) return undefined;
    this.taskControllers.get(taskId)?.abort(new Error(reason));
    cancelled.error = reason;
    this.taskStore.upsert(cancelled);
    this.sessions.removePendingTask(cancelled.sessionId, cancelled.id);
    this.audit.record({
      type: "task.cancelled",
      actor,
      subjectId: cancelled.id,
      data: { sessionId: cancelled.sessionId, kind: cancelled.kind, reason },
    });
    EventBus.emit("task:failed", {
      taskId: cancelled.id,
      sessionId: cancelled.sessionId,
      error: reason,
    });
    return cancelled;
  }

  private taskIsCancelled(task: Task): boolean {
    return task.status === "cancelled";
  }

  private cancelPlanAfterRejection(
    rejectedTask: Task,
    reason: string,
    actor: "user" | "system",
  ): void {
    if (!rejectedTask.planId) return;
    const execution = this.planStore.get(rejectedTask.planId);
    if (!execution || ["complete", "failed", "cancelled"].includes(execution.status)) return;

    const relatedTasks = this.taskStore
      .list(rejectedTask.sessionId)
      .filter((task) => task.planId === rejectedTask.planId);
    const openStatuses = new Set<Task["status"]>(["queued", "running", "awaiting-approval"]);
    for (const task of relatedTasks) {
      if (task.id === rejectedTask.id || !openStatuses.has(task.status)) continue;
      if (task.status === "awaiting-approval") {
        this.approvals.reject(task.id, reason);
      }
      this.cancelTask(task.id, `plan cancelled after approval rejection: ${reason}`, actor);
    }

    this.recordPlanExecution(
      execution.plan,
      execution.sessionId,
      Array.from(new Set([...execution.taskIds, ...relatedTasks.map((task) => task.id)])),
      "cancelled",
    );
    this.audit.record({
      type: "plan.cancelled_after_approval_rejection",
      actor,
      subjectId: execution.plan.id,
      data: {
        rejectedTaskId: rejectedTask.id,
        sessionId: rejectedTask.sessionId,
        reason,
      },
    });
  }

  private async resumeRecoveredState(
    plans: StoredPlanExecution[],
    standaloneTasks: Task[],
  ): Promise<void> {
    if (this.recoveryScheduled) return;
    this.recoveryScheduled = true;
    try {
      for (const execution of plans) {
        if (!this.started) break;
        await this.continuePlanExecution(execution, {
          reuseOpenTasks: true,
          reason: "restart-recovery",
        });
      }

      for (const task of standaloneTasks) {
        if (!this.started) break;
        if (task.status === "awaiting-approval") continue;
        if (task.status !== "queued") continue;
        await this.dispatchQueuedTask(task);
      }
    } finally {
      this.recoveryScheduled = false;
    }
  }

  private async continuePlanExecution(
    execution: StoredPlanExecution,
    opts: { reuseOpenTasks: boolean; reason: "restart-recovery" | "manual-retry" },
  ): Promise<SymphonyResult> {
    const planTasks = this.taskStore
      .list(execution.sessionId)
      .filter((task) => task.planId === execution.plan.id);
    const completedByStep = new Map<string, Task>();
    const openByStep = new Map<string, Task>();
    for (const task of planTasks) {
      if (!task.stepId) continue;
      if (task.status === "complete") completedByStep.set(task.stepId, task);
      if (["queued", "awaiting-approval"].includes(task.status)) {
        openByStep.set(task.stepId, task);
      }
    }

    const completedStepIds = new Set(completedByStep.keys());
    const outputs: SymphonyResult["outputs"] = execution.plan.steps
      .map((step) => completedByStep.get(step.id))
      .filter((task): task is Task => Boolean(task))
      .map((task) => ({
        stepId: task.stepId!,
        taskId: task.id,
        ok: true,
        output: task.result,
        attempts: Math.max(1, task.attempts),
      }));
    const taskIds = Array.from(new Set([
      ...execution.taskIds,
      ...planTasks.map((task) => task.id),
    ]));
    this.recordPlanExecution(execution.plan, execution.sessionId, taskIds, "running");

    const result = await this.symphony.runPlan(execution.plan, {
      executeStep: async (step, planId) => {
        let task: Task;
        let taskResult: TaskResult;
        const recoveredTask = opts.reuseOpenTasks ? openByStep.get(step.id) : undefined;
        if (recoveredTask?.status === "awaiting-approval") {
          task = recoveredTask;
          taskResult = {
            ok: false,
            error: "approval required for task " + task.id,
            output: { awaitingApproval: true, taskId: task.id },
          };
        } else if (recoveredTask?.status === "queued") {
          task = recoveredTask;
          taskResult = await this.dispatchQueuedTask(task);
        } else {
          const created = await this.executeStep(execution.sessionId, step, planId);
          task = created.task;
          taskResult = created.result;
          taskIds.push(task.id);
        }
        openByStep.delete(step.id);
        this.recordPlanExecution(execution.plan, execution.sessionId, taskIds, "running");
        return { taskId: task.id, result: taskResult };
      },
      recoverStep: (step, failure) => this.recoverStep(step, failure),
    }, {
      completedStepIds,
      outputs,
    });

    this.recordPlanExecution(
      result.plan,
      execution.sessionId,
      taskIds,
      this.stopping ? "running" : result.status,
    );
    this.audit.record({
      type: opts.reason === "restart-recovery" ? "plan.recovered" : "plan.retry_completed",
      actor: opts.reason === "restart-recovery" ? "system" : "user",
      subjectId: execution.plan.id,
      data: {
        sessionId: execution.sessionId,
        status: result.status,
        taskIds,
      },
    });
    if (result.response) {
      this.sessions.appendMessage(execution.sessionId, { role: "assistant", content: result.response });
      this.memory.add({
        sessionId: execution.sessionId,
        role: "assistant",
        content: result.response,
        tags: [opts.reason, result.status],
        taskId: taskIds[taskIds.length - 1],
      });
    }
    return result;
  }

  private failTask(task: Task, error: string): void {
    if (task.status !== "failed") {
      this.queue.transition(task, "failed");
    }
    task.error = error;
    this.taskStore.upsert(task);
    this.sessions.removePendingTask(task.sessionId, task.id);
    this.healing.observeFailure(task.id, task.sessionId, error);
    const procedureId = typeof task.payload.healingProcedureId === "string"
      ? task.payload.healingProcedureId
      : null;
    if (procedureId) {
      this.healing.recordProcedureOutcome(procedureId, false);
      this.audit.record({
        type: "healing.procedure_failed",
        actor: "system",
        subjectId: procedureId,
        data: { taskId: task.id, sessionId: task.sessionId, kind: task.kind, error },
      });
    }
    this.audit.record({
      type: "task.failed",
      actor: "system",
      subjectId: task.id,
      data: { sessionId: task.sessionId, kind: task.kind, error },
    });
  }

  private ensureSession(sessionId?: string): Session {
    this.sessions.recover();
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing) {
        if (existing.status !== "active") {
          const previousStatus = existing.status;
          this.sessions.setStatus(existing.id, "active");
          this.audit.record({
            type: "session.reopened",
            actor: "user",
            subjectId: existing.id,
            data: { previousStatus },
          });
        }
        return this.sessions.get(existing.id) ?? existing;
      }
    }
    return this.createSession({ source: "agentix-shell" });
  }

  private createTask(sessionId: string, step: PlanStep, planId: string): Task {
    const agent = this.agents.forKind(step.kind);
    const session = this.sessions.get(sessionId);
    const skillContext = ["user-message", "luna-message", "terra-message"].includes(step.kind)
      ? this.skills.promptFor(session?.metadata.skills)
      : { ids: [], prompt: "" };
    return {
      id: `task-${randomUUID().slice(0, 8)}`,
      sessionId,
      planId,
      stepId: step.id,
      dependsOn: step.dependsOn,
      kind: step.kind,
      priority: step.priority,
      status: "queued",
      payload: {
        ...step.payload,
        ...(skillContext.prompt
          ? { skillInstructions: skillContext.prompt, activeSkills: skillContext.ids }
          : {}),
      },
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: step.maxAttempts,
      requiresApproval: step.requiresApproval || agent instanceof CommandAgent,
    };
  }

  private registerDefaultAgents(): void {
    const config = loadConfig();
    if (!this.agents.forKind("user-message")) {
      this.agents.register(new ConversationAgent());
    }
    if (config.lunaModel && !this.agents.forKind("luna-message")) {
      this.agents.register(new DelegatedConversationAgent("luna"));
    }
    if (config.terraModel && !this.agents.forKind("terra-message")) {
      this.agents.register(new DelegatedConversationAgent("terra"));
    }
    if (!this.agents.forKind("bash")) {
      this.agents.register(new BashAgent({ cwd: process.cwd() }));
    }
    if (!this.agents.forKind("code-edit")) {
      this.agents.register(new CodeAgent({ projectRoot: PATHS.projectRoot }));
    }
    if (!this.agents.forKind("sandbox-run")) {
      this.agents.register(new SandboxAgent());
    }
    for (const profile of this.agentProfiles.enabled()) {
      if (!this.agents.get(profile.id)) {
        this.agents.register(new CommandAgent(profile));
      }
    }
  }

  private approvalResponse(taskIds: string[]): string {
    const pending = taskIds
      .map((id) => this.queue.get(id))
      .filter((task): task is Task => Boolean(task && task.status === "awaiting-approval"));
    if (pending.length === 0) return "Approval required.";

    return pending
      .map((task) => [
        `Approval required for ${task.kind} task ${task.id}.`,
        "Use the Agentix approval command or call the Agentix approval endpoint to continue.",
        `Payload: ${JSON.stringify(task.payload, null, 2)}`,
      ].join("\n"))
      .join("\n\n");
  }

  private streamChunks(text: string): string[] {
    return text.split(/(\s+)/).filter((part) => part.length > 0);
  }
}
