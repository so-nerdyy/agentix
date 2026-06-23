import { randomUUID } from "node:crypto";
import { AuditLog } from "../audit/AuditLog.js";
import { EventBus } from "../config/EventBus.js";
import { PATHS } from "../config/paths.js";
import { BashAgent } from "../pi/BashAgent.js";
import { CodeAgent } from "../pi/CodeAgent.js";
import { ConversationAgent } from "../pi/ConversationAgent.js";
import { SandboxAgent } from "../pi/SandboxAgent.js";
import { HealingEngine } from "../healing/HealingEngine.js";
import { MemoryStore } from "../memory/MemoryStore.js";
import { PlanStore } from "../symphony/PlanStore.js";
import { SymphonyEngine } from "../symphony/SymphonyEngine.js";
import type { PlanStep, SymphonyResult } from "../symphony/types.js";
import { ApprovalWorkflow } from "./ApprovalWorkflow.js";
import { PIAgentRegistry } from "./PIAgentRegistry.js";
import { SessionCoordinator } from "./SessionCoordinator.js";
import { TaskQueue } from "./TaskQueue.js";
import { TaskStore } from "./TaskStore.js";
import type { Session, Task, TaskAction, TaskResult } from "./types.js";

export interface ExecuteStimulusOptions {
  stimulus: string;
  sessionId?: string;
  onDelta?: (delta: string) => void;
}

export interface ExecuteStimulusResult {
  response: string;
  sessionId: string;
  taskIds: string[];
  status: "complete" | "awaiting-approval" | "failed";
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
  private started = false;
  private recoveryScheduled = false;

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
    this.approvals.setTimeoutHandler((task, reason) => {
      this.rejectExpiredApproval(task.id, reason);
    });
  }

  start(): void {
    if (this.started) return;
    EventBus.emit("powerhouse:starting", {});
    this.sessions.recover();
    const recoveredTasks = this.taskStore.recoverOpen().map((task) => {
      if (task.status === "running") {
        task.status = "queued";
        task.startedAt = undefined;
        this.taskStore.upsert(task);
      }
      return task;
    });
    this.queue.hydrate(recoveredTasks);
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
      data: { recoveredTasks: recoveredTasks.length },
    });
    EventBus.emit("powerhouse:started", {});
    if (recoveredTasks.length > 0) {
      void this.resumeRecoveredWork(recoveredTasks);
    }
  }

  stop(): void {
    if (!this.started) return;
    EventBus.emit("powerhouse:stopping", {});
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
    EventBus.emit("session:create", { sessionId: session.id });
    return session;
  }

  closeSession(id: string): void {
    this.sessions.close(id);
    EventBus.emit("session:close", { sessionId: id });
  }

  renameSession(id: string, title: string): Session | undefined {
    this.start();
    return this.sessions.updateMetadata(id, { title });
  }

  listTasks(sessionId?: string): Task[] {
    return this.taskStore.list(sessionId);
  }

  listApprovals(): Task[] {
    return this.approvals.listPending();
  }

  async approve(taskId: string): Promise<TaskResult> {
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
      ok: continuation.status !== "failed",
      output: {
        approvedTaskId: task.id,
        approvedOutput: approvedResult.output,
        continuation,
      },
      error: continuation.status === "failed" ? continuation.response : undefined,
    };
  }

  reject(taskId: string, reason?: string): boolean {
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
    EventBus.emit("task:failed", {
      taskId: task.id,
      sessionId: task.sessionId,
      error: reason,
    });
    return true;
  }

  async controlTask(taskId: string, action: TaskAction): Promise<TaskResult> {
    const task = this.queue.get(taskId);
    if (!task) return { ok: false, error: `unknown task: ${taskId}` };
    if (action === "cancel") {
      const cancelled = this.queue.cancel(taskId);
      if (!cancelled) return { ok: false, error: `task cannot be cancelled: ${taskId}` };
      cancelled.error = cancelled.error ?? "cancelled";
      this.taskStore.upsert(cancelled);
      this.sessions.removePendingTask(cancelled.sessionId, cancelled.id);
      this.audit.record({
        type: "task.cancelled",
        actor: "user",
        subjectId: cancelled.id,
        data: { sessionId: cancelled.sessionId, kind: cancelled.kind },
      });
      EventBus.emit("task:failed", {
        taskId: cancelled.id,
        sessionId: cancelled.sessionId,
        error: cancelled.error ?? "cancelled",
      });
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

  async executeStimulus(opts: ExecuteStimulusOptions): Promise<ExecuteStimulusResult> {
    this.start();
    const session = this.ensureSession(opts.sessionId);
    const taskIds: string[] = [];

    this.memory.add({
      sessionId: session.id,
      role: "user",
      content: opts.stimulus,
      tags: ["stimulus"],
    });

    const result = await this.symphony.run(opts.stimulus, {
      executeStep: async (step, planId) => {
        const { task, result } = await this.executeStep(session.id, step, planId);
        taskIds.push(task.id);
        return { taskId: task.id, result };
      },
      recoverStep: (step, failure) => this.recoverStep(step, failure),
    });

    const status = result.status;
    this.recordPlanExecution(result.plan, session.id, taskIds, status);

    const response = status === "awaiting-approval"
      ? this.approvalResponse(taskIds)
      : result.response;

    for (const chunk of this.streamChunks(response)) {
      opts.onDelta?.(chunk);
    }

    this.memory.add({
      sessionId: session.id,
      role: "assistant",
      content: response,
      tags: [status],
      taskId: taskIds[taskIds.length - 1],
    });

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

  private async executeStep(sessionId: string, step: PlanStep, planId: string): Promise<{ task: Task; result: TaskResult }> {
    const task = this.createTask(sessionId, step, planId);
    this.queue.enqueue(task);
    this.taskStore.upsert(task);
    this.sessions.addPendingTask(sessionId, task.id);
    EventBus.emit("task:queued", { taskId: task.id, sessionId, kind: task.kind });

    const running = this.queue.dequeue(sessionId);
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

    return { task: running, result: await this.runTask(running) };
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

    if (step.kind === "user-message") {
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
    this.recordPlanExecution(result.plan, task.sessionId, taskIds, result.status);
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
    status: SymphonyResult["status"],
  ): void {
    this.planStore.upsert({ plan, sessionId, taskIds, status });
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

  private async runTask(task: Task): Promise<TaskResult> {
    const agent = this.agents.pickFor(task);
    if (!agent) {
      const error = `no Pi agent registered for ${task.kind}`;
      this.failTask(task, error);
      return { ok: false, error };
    }

    const result = await agent.execute(task);
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

  private async resumeRecoveredWork(tasks: Task[]): Promise<void> {
    if (this.recoveryScheduled || tasks.length === 0) return;
    this.recoveryScheduled = true;
    try {
      const sessionIds = [...new Set(tasks.map((task) => task.sessionId))];
      for (const sessionId of sessionIds) {
        if (!this.started) break;
        const session = this.sessions.get(sessionId);
        if (!session || session.status !== "active") continue;

        while (this.started) {
          const next = this.queue.nextForSession(sessionId);
          if (!next) break;
          const running = this.queue.dequeue(sessionId);
          if (!running) break;
          EventBus.emit("task:running", { taskId: running.id, sessionId });
          this.taskStore.upsert(running);

          if (running.requiresApproval) {
            this.approvals.request(running);
            this.audit.record({
              type: "approval.requested",
              actor: "system",
              subjectId: running.id,
              data: { sessionId, kind: running.kind, payload: running.payload, recovered: true },
            });
            break;
          }

          const result = await this.runTask(running);
          if (!result.ok) break;
        }
      }
    } finally {
      this.recoveryScheduled = false;
    }
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
      if (existing) return existing;
    }
    return this.createSession({ source: "hermes-frontend" });
  }

  private createTask(sessionId: string, step: PlanStep, planId: string): Task {
    return {
      id: `task-${randomUUID().slice(0, 8)}`,
      sessionId,
      planId,
      stepId: step.id,
      dependsOn: step.dependsOn,
      kind: step.kind,
      priority: step.priority,
      status: "queued",
      payload: step.payload,
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: step.maxAttempts,
      requiresApproval: step.requiresApproval,
    };
  }

  private registerDefaultAgents(): void {
    if (!this.agents.forKind("user-message")) {
      this.agents.register(new ConversationAgent());
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
  }

  private approvalResponse(taskIds: string[]): string {
    const pending = taskIds
      .map((id) => this.queue.get(id))
      .filter((task): task is Task => Boolean(task && task.status === "awaiting-approval"));
    if (pending.length === 0) return "Approval required.";

    return pending
      .map((task) => [
        `Approval required for ${task.kind} task ${task.id}.`,
        "Use the Hermes approval command or call the Agentix approval endpoint to continue.",
        `Payload: ${JSON.stringify(task.payload, null, 2)}`,
      ].join("\n"))
      .join("\n\n");
  }

  private streamChunks(text: string): string[] {
    return text.split(/(\s+)/).filter((part) => part.length > 0);
  }
}
