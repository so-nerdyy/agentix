import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BasePIAgent } from "../../src/pi/BasePIAgent.js";
import { AgentProfileStore } from "../../src/pi/AgentProfileStore.js";
import { ConversationAgent } from "../../src/pi/ConversationAgent.js";
import { AuditLog } from "../../src/audit/AuditLog.js";
import { HealingEngine } from "../../src/healing/HealingEngine.js";
import { MemoryStore } from "../../src/memory/MemoryStore.js";
import { ApprovalWorkflow } from "../../src/powerhouse/ApprovalWorkflow.js";
import { PIAgentRegistry } from "../../src/powerhouse/PIAgentRegistry.js";
import { Powerhouse } from "../../src/powerhouse/Powerhouse.js";
import { SessionCoordinator } from "../../src/powerhouse/SessionCoordinator.js";
import { TaskQueue } from "../../src/powerhouse/TaskQueue.js";
import { LocalAgentixRuntime } from "../../src/runtime/LocalAgentixRuntime.js";
import { TaskStore } from "../../src/powerhouse/TaskStore.js";
import { SchedulerService } from "../../src/scheduler/SchedulerService.js";
import { ScheduledJobStore } from "../../src/scheduler/ScheduledJobStore.js";
import { PlanStore } from "../../src/symphony/PlanStore.js";
import type { Task, TaskResult } from "../../src/powerhouse/types.js";

const tempDirs: string[] = [];

function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  tempDirs.push(dir);
  return dir;
}

function makePowerhouse(): Powerhouse {
  const dir = tempDir("agentix-powerhouse-");
  const registry = new PIAgentRegistry();
  registry.register(new ConversationAgent());

  return new Powerhouse({
    sessions: new SessionCoordinator(join(dir, "sessions")),
    queue: new TaskQueue(),
    approvals: new ApprovalWorkflow({ timeoutMs: 10_000 }),
    agents: registry,
    memory: new MemoryStore(join(dir, "memory.jsonl")),
    healing: new HealingEngine(join(dir, "healing.json")),
    planStore: new PlanStore(join(dir, "plans.json")),
    taskStore: new TaskStore(join(dir, "tasks.json")),
    audit: new AuditLog(join(dir, "audit.jsonl")),
  });
}

class HealingAwareAgent extends BasePIAgent {
  constructor() {
    super("user-message", "pi-healing-aware");
  }

  async execute(task: Task): Promise<TaskResult> {
    this.emitStart(task);
    const advice = String(task.payload.healingAdvice ?? "");
    if (advice.includes("Promoted healing procedure")) {
      const result = { ok: true, output: `recovered with ${task.payload.healingProcedureId}` };
      this.emitComplete(task, result);
      return result;
    }
    const error = "known healing failure 4242";
    this.emitError(task, error);
    return { ok: false, error };
  }
}

class HealingResistantAgent extends BasePIAgent {
  constructor() {
    super("user-message", "pi-healing-resistant");
  }

  async execute(task: Task): Promise<TaskResult> {
    this.emitStart(task);
    const error = "known healing failure 4242";
    this.emitError(task, error);
    return { ok: false, error };
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("Powerhouse restored runtime", () => {
  it("executes a normal Hermes message through Symphony and a Pi agent", async () => {
    const powerhouse = makePowerhouse();

    const result = await powerhouse.executeStimulus({
      stimulus: "hello agentix",
    });

    expect(result.status).toBe("complete");
    expect(result.response).toContain("Powerhouse accepted the task");
    expect(result.response).toContain("Pi agent executed");
    expect(result.taskIds).toHaveLength(1);
    expect(powerhouse.listTasks()[0]?.status).toBe("complete");
    expect(powerhouse.memory.search("hello").length).toBeGreaterThanOrEqual(1);

    powerhouse.stop();
  });

  it("parks shell commands behind approval instead of executing them directly", async () => {
    const powerhouse = makePowerhouse();

    const result = await powerhouse.executeStimulus({
      stimulus: "run: echo hello",
    });

    expect(result.status).toBe("awaiting-approval");
    expect(result.response).toContain("Approval required");
    expect(powerhouse.listApprovals()).toHaveLength(1);
    expect(powerhouse.listTasks()[0]?.kind).toBe("bash");

    powerhouse.stop();
  });

  it("persists approval timeout as a rejected task", async () => {
    vi.useFakeTimers();
    const powerhouse = makePowerhouse();
    try {
      const result = await powerhouse.executeStimulus({
        stimulus: "run: echo timeout-reject",
      });
      const taskId = result.taskIds[0]!;

      expect(result.status).toBe("awaiting-approval");
      expect(powerhouse.listApprovals()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(10_050);

      const task = powerhouse.listTasks().find((item) => item.id === taskId);
      expect(powerhouse.listApprovals()).toHaveLength(0);
      expect(task?.status).toBe("rejected");
      expect(task?.error).toContain("approval timeout");
      expect(powerhouse.audit.list().some((entry) => entry.type === "approval.timeout_rejected")).toBe(true);
    } finally {
      powerhouse.stop();
      vi.useRealTimers();
    }
  });

  it("executes approved shell commands through the platform shell", async () => {
    const powerhouse = makePowerhouse();

    const result = await powerhouse.executeStimulus({
      stimulus: "run: echo agentix-approved-shell",
    });
    const taskId = result.taskIds[0];

    const approved = await powerhouse.approve(taskId!);

    expect(approved.ok).toBe(true);
    expect(JSON.stringify(approved.output)).toContain("agentix-approved-shell");
    expect(powerhouse.listTasks()[0]?.status).toBe("complete");

    powerhouse.stop();
  });

  it("runtime facade exposes tasks, tools, sessions, and approvals", async () => {
    const runtime = new LocalAgentixRuntime();

    const session = runtime.createSession({ model: "test-model" });
    const result = await runtime.execute({
      sessionId: session.id,
      stimulus: "test runtime facade",
    });

    expect(result.status).toBe("complete");
    const listedSession = runtime.listSessions().find((item) => item.id === session.id);
    expect(listedSession?.status).toBe("active");
    expect(listedSession?.metadata.model).toBe("test-model");
    expect(listedSession?.updatedAt).toBeTruthy();
    expect(runtime.listTasks(session.id)).toHaveLength(1);
    const sessionPlans = runtime.listPlans().filter((plan) => plan.sessionId === session.id);
    expect(sessionPlans).toHaveLength(1);
    expect(runtime.getPlan(String(sessionPlans[0]?.id))?.steps).toHaveLength(1);
    const replayedPlan = await runtime.controlPlan(String(sessionPlans[0]?.id), "replay");
    expect(replayedPlan.ok).toBe(true);
    expect(JSON.stringify(replayedPlan)).toContain("sourcePlanId");
    const cancelledPlan = await runtime.controlPlan(String(sessionPlans[0]?.id), "cancel");
    expect(cancelledPlan).toMatchObject({ ok: true, action: "cancel" });
    expect(runtime.listMemory(session.id).some((item) => String(item.content).includes("test runtime facade"))).toBe(true);
    expect(runtime.listTools().some((tool) => tool.name === "user-message")).toBe(true);
    expect(Array.isArray(runtime.listApprovals())).toBe(true);
    const doctor = runtime.doctor();
    expect(String(doctor.status)).toMatch(/pass|warn|fail/);
    expect(Array.isArray(doctor.checks)).toBe(true);
    expect((doctor.checks as Array<{ id: string }>).some((check) => check.id === "sandbox.isolation")).toBe(true);
    expect((doctor.checks as Array<{ id: string }>).some((check) => check.id === "install.assets")).toBe(true);
    expect((doctor.install as { packageName?: string; packageVersion?: string }).packageName).toBe("agentix");
    expect((doctor.install as { packageName?: string; packageVersion?: string }).packageVersion).toMatch(/\d+\.\d+\.\d+/);
    const usage = runtime.usage() as {
      counts: { sessions: number; tasks: number; plans: number; memory: number };
      tasksByStatus: Record<string, number>;
    };
    expect(usage.counts.sessions).toBeGreaterThan(0);
    expect(usage.counts.tasks).toBeGreaterThan(0);
    expect(usage.counts.plans).toBeGreaterThan(0);
    expect(usage.counts.memory).toBeGreaterThan(0);
    expect(usage.tasksByStatus.complete).toBeGreaterThan(0);

    runtime.shutdown();
  });

  it("returns detailed approval information for awaiting tasks", async () => {
    const runtime = new LocalAgentixRuntime();

    const result = await runtime.execute({
      stimulus: "run: echo approval-detail",
    });
    const taskId = result.taskIds[0];
    const detail = runtime.getApproval(taskId);

    expect(detail).not.toBeNull();
    expect(detail?.approval.id).toBe(taskId);
    expect(detail?.approval.status).toBe("awaiting-approval");
    expect(Array.isArray(detail?.memory)).toBe(true);
    expect(Array.isArray(detail?.audit)).toBe(true);
    expect(Array.isArray(detail?.logs)).toBe(true);

    runtime.shutdown();
  });

  it("exposes audit-backed runtime logs", async () => {
    const runtime = new LocalAgentixRuntime();

    await runtime.execute({
      stimulus: "log me",
    });

    const logs = runtime.listLogs();

    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]?.message).toContain("stimulus.executed");

    runtime.shutdown();
  });

  it("returns detailed audit information", async () => {
    const runtime = new LocalAgentixRuntime();

    const result = await runtime.execute({
      stimulus: "audit detail smoke",
    });
    const taskId = result.taskIds[0];
    const auditEntries = runtime.listAudit();
    expect(auditEntries.length).toBeGreaterThan(0);
    const detail = runtime.getAudit(auditEntries[0]!.id);

    expect(detail).not.toBeNull();
    expect(detail?.audit.id).toBe(auditEntries[0]!.id);
    expect(Array.isArray(detail?.relatedTasks)).toBe(true);
    expect(Array.isArray(detail?.relatedSessions)).toBe(true);
    expect(Array.isArray(detail?.logs)).toBe(true);
    expect(detail?.relatedTasks.length).toBeGreaterThanOrEqual(0);

    runtime.shutdown();
  });

  it("searches tasks, sessions, logs, memory, audit, jobs, and healing records", async () => {
    const runtime = new LocalAgentixRuntime();

    const session = runtime.createSession({ model: "search-model" });
    const result = await runtime.execute({
      sessionId: session.id,
      stimulus: "searchable runtime record",
    });
    const taskId = result.taskIds[0];
    const taskSearch = runtime.search("searchable");
    const sessionSearch = runtime.search(session.id);

    expect(taskSearch.query).toBe("searchable");
    expect(sessionSearch.query).toBe(session.id);
    expect(Array.isArray(taskSearch.tasks)).toBe(true);
    expect(Array.isArray(taskSearch.sessions)).toBe(true);
    expect(Array.isArray(taskSearch.memory)).toBe(true);
    expect(Array.isArray(taskSearch.audit)).toBe(true);
    expect(Array.isArray(taskSearch.logs)).toBe(true);
    expect(Array.isArray(taskSearch.jobs)).toBe(true);
    expect(Array.isArray(taskSearch.plans)).toBe(true);
    expect(Array.isArray(taskSearch.healing)).toBe(true);
    expect(Array.isArray(taskSearch.gateways)).toBe(true);
    expect(taskSearch.tasks.length).toBeGreaterThan(0);
    expect(taskSearch.plans.length).toBeGreaterThan(0);
    expect(sessionSearch.sessions.some((item) => item.id === session.id)).toBe(true);

    runtime.shutdown();
  });

  it("deletes sessions through the runtime facade", async () => {
    const runtime = new LocalAgentixRuntime();

    const session = runtime.createSession({ model: "test-model" });
    expect(runtime.listSessions().some((item) => item.id === session.id)).toBe(true);
    expect(runtime.listAudit().some((item) => item.type === "session.created" && item.subjectId === session.id)).toBe(true);

    runtime.deleteSession(session.id);

    const archived = runtime.listSessions().find((item) => item.id === session.id);
    expect(archived?.status).toBe("complete");
    expect(runtime.listAudit().some((item) => item.type === "session.closed" && item.subjectId === session.id)).toBe(true);

    runtime.shutdown();
  });

  it("keeps closed sessions in history after recovery", () => {
    const dir = tempDir("agentix-session-history-");
    const sessions = new SessionCoordinator(dir);
    const session = sessions.create({ title: "Historical Session" });

    sessions.close(session.id);

    const recovered = new SessionCoordinator(dir);
    const active = recovered.recover();
    const historical = recovered.list().find((item) => item.id === session.id);

    expect(active).toHaveLength(0);
    expect(historical?.status).toBe("complete");
    expect(historical?.metadata.title).toBe("Historical Session");
  });

  it("renames, prunes, and optimizes sessions through the runtime facade", async () => {
    const runtime = new LocalAgentixRuntime();

    const session = runtime.createSession({ model: "rename-model" });
    const renamed = runtime.renameSession(session.id, "Renamed Session");
    const detail = runtime.getSession(session.id);
    const optimized = runtime.optimizeSessions();
    const pruned = runtime.pruneSessions({ olderThanDays: 0, source: "agentix-runtime" });

    expect(renamed.ok).toBe(true);
    expect(detail?.session.metadata.title).toBe("Renamed Session");
    expect(optimized.ok).toBe(true);
    expect(pruned.ok).toBe(true);
    expect(pruned.pruned).toContain(session.id);
    expect(runtime.listSessions().find((item) => item.id === session.id)?.status).toBe("complete");

    runtime.shutdown();
  });

  it("controls task lifecycle through the runtime facade", async () => {
    const runtime = new LocalAgentixRuntime();

    const result = await runtime.execute({
      stimulus: "task control smoke",
    });
    const taskId = result.taskIds[0];
    const detail = runtime.getTask(taskId);
    expect(detail?.task.status).toBe("complete");

    const restarted = await runtime.controlTask(taskId, "restart");
    expect(restarted.ok).toBe(true);
    expect(restarted.output).toMatchObject({ action: "restart", taskId, status: "complete" });
    expect(runtime.getTask(taskId)?.task.status).toBe("complete");

    runtime.shutdown();
  });

  it("resumes recovered queued work after restart", async () => {
    const dir = tempDir("agentix-recovery-");
    const sessions = new SessionCoordinator(join(dir, "sessions"));
    const taskStore = new TaskStore(join(dir, "tasks.json"));
    const registry = new PIAgentRegistry();
    registry.register(new ConversationAgent());
    const powerhouse = new Powerhouse({
      sessions,
      queue: new TaskQueue(),
      approvals: new ApprovalWorkflow({ timeoutMs: 10_000 }),
      agents: registry,
      memory: new MemoryStore(join(dir, "memory.jsonl")),
      healing: new HealingEngine(join(dir, "healing.json")),
      planStore: new PlanStore(join(dir, "plans.json")),
      taskStore,
      audit: new AuditLog(join(dir, "audit.jsonl")),
    });

    const session = sessions.create({ source: "recovery-test" });
    const task = {
      id: "task-recovery",
      sessionId: session.id,
      kind: "user-message" as const,
      priority: "user" as const,
      status: "queued" as const,
      payload: { stimulus: "resume me" },
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: 1,
      requiresApproval: false,
      dependsOn: [] as string[],
    };
    taskStore.upsert(task);

    powerhouse.start();

    let recoveredStatus: string | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      recoveredStatus = powerhouse.listTasks().find((item) => item.id === task.id)?.status;
      if (recoveredStatus === "complete") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(recoveredStatus).toBe("complete");

    powerhouse.stop();
  });

  it("returns a detailed task view with related memory and audit entries", async () => {
    const runtime = new LocalAgentixRuntime();

    const result = await runtime.execute({
      stimulus: "detail me",
    });

    const taskId = result.taskIds[0];
    expect(taskId).toBeDefined();

    const detail = runtime.getTask(taskId);
    expect(detail).not.toBeNull();
    expect(detail?.task.id).toBe(taskId);
    expect(detail?.memory.length).toBeGreaterThan(0);
    expect(detail?.audit.length).toBeGreaterThan(0);
    expect(Array.isArray(detail?.logs)).toBe(true);

    runtime.shutdown();
  });

  it("runs explicit multi-step plans with dependencies", async () => {
    const powerhouse = makePowerhouse();
    const plan = {
      steps: [
        {
          id: "say",
          kind: "user-message",
          payload: { stimulus: "first" },
        },
        {
          id: "follow",
          kind: "user-message",
          dependsOn: ["say"],
          payload: { stimulus: "second" },
        },
      ],
    };

    const result = await powerhouse.executeStimulus({
      stimulus: `plan: ${JSON.stringify(plan)}`,
    });

    expect(result.status).toBe("complete");
    expect(result.taskIds).toHaveLength(2);
    expect(powerhouse.listTasks().map((task) => task.stepId)).toEqual(["say", "follow"]);

    powerhouse.stop();
  });

  it("streams execution progress before the final response", async () => {
    const powerhouse = makePowerhouse();
    const deltas: string[] = [];

    const execution = powerhouse.executeStimulus({
      stimulus: "stream progress smoke",
      onDelta: (delta) => deltas.push(delta),
    });

    expect(deltas[0]).toContain("Planning task with Symphony");

    const result = await execution;

    expect(result.status).toBe("complete");
    expect(deltas.some((delta) => delta.includes("Running step"))).toBe(true);
    expect(deltas.some((delta) => delta.includes("Execution complete"))).toBe(true);
    expect(deltas.join("")).toContain(result.response);

    powerhouse.stop();
  });

  it("continues dependent plan steps after approval", async () => {
    const powerhouse = makePowerhouse();
    const plan = {
      steps: [
        {
          id: "approved-shell",
          kind: "bash",
          payload: { commandLine: "echo approval-continuation" },
          requiresApproval: true,
        },
        {
          id: "follow-up",
          kind: "user-message",
          dependsOn: ["approved-shell"],
          payload: { stimulus: "after approval continuation" },
        },
      ],
    };

    const paused = await powerhouse.executeStimulus({
      stimulus: `plan: ${JSON.stringify(plan)}`,
    });
    const approvalTaskId = paused.taskIds[0];

    expect(paused.status).toBe("awaiting-approval");
    expect(powerhouse.listTasks().map((task) => task.stepId)).toEqual(["approved-shell"]);

    const approved = await powerhouse.approve(approvalTaskId!);
    const tasks = powerhouse.listTasks();
    const execution = powerhouse.planStore.list()[0];

    expect(approved.ok).toBe(true);
    expect(JSON.stringify(approved.output)).toContain("approval-continuation");
    expect(JSON.stringify(approved.output)).toContain("after approval continuation");
    expect(tasks.map((task) => task.stepId)).toEqual(["approved-shell", "follow-up"]);
    expect(tasks.every((task) => task.status === "complete")).toBe(true);
    expect(execution?.status).toBe("complete");
    expect(execution?.taskIds).toHaveLength(2);
    expect(powerhouse.audit.list().some((entry) => entry.type === "plan.resumed_after_approval")).toBe(true);

    powerhouse.stop();
  });

  it("persists tasks for recovery and API listing", async () => {
    const dir = tempDir("agentix-persist-");
    const taskStore = new TaskStore(join(dir, "tasks.json"));
    const powerhouse = new Powerhouse({
      sessions: new SessionCoordinator(join(dir, "sessions")),
      queue: new TaskQueue(),
      approvals: new ApprovalWorkflow({ timeoutMs: 10_000 }),
      memory: new MemoryStore(join(dir, "memory.jsonl")),
      healing: new HealingEngine(join(dir, "healing.json")),
      planStore: new PlanStore(join(dir, "plans.json")),
      taskStore,
      audit: new AuditLog(join(dir, "audit.jsonl")),
    });

    await powerhouse.executeStimulus({ stimulus: "persist me" });
    expect(taskStore.list()).toHaveLength(1);
    expect(new TaskStore(join(dir, "tasks.json")).list()[0]?.status).toBe("complete");

    powerhouse.stop();
  });

  it("creates healing procedure candidates after repeated failures", async () => {
    const powerhouse = makePowerhouse();
    const failingPlan = {
      steps: [
        {
          id: "fail",
          kind: "sandbox-run",
          payload: {
            code: "process.exit(1)",
            filename: "fail.js",
            command: ["node", "fail.js"],
          },
          requiresApproval: false,
          maxAttempts: 1,
        },
      ],
    };

    await powerhouse.executeStimulus({ stimulus: `plan: ${JSON.stringify(failingPlan)}` });
    await powerhouse.executeStimulus({ stimulus: `plan: ${JSON.stringify(failingPlan)}` });

    const procedures = powerhouse.healing.listProcedures();
    expect(procedures.some((procedure) => procedure.status === "candidate")).toBe(true);

    const promoted = powerhouse.healing.promoteProcedure(procedures[0]!.id);
    expect(promoted?.status).toBe("promoted");

    powerhouse.stop();
  });

  it("applies promoted healing procedures to retry attempts", async () => {
    const dir = tempDir("agentix-healing-apply-");
    const healing = new HealingEngine(join(dir, "healing.json"));
    healing.observeFailure("seed-1", "seed-session", "known healing failure 4242");
    healing.observeFailure("seed-2", "seed-session", "known healing failure 4242");
    const candidate = healing.listProcedures()[0];
    expect(candidate).toBeDefined();
    const promoted = healing.promoteProcedure(candidate!.id);
    expect(promoted?.status).toBe("promoted");

    const registry = new PIAgentRegistry();
    registry.register(new HealingAwareAgent());
    const audit = new AuditLog(join(dir, "audit.jsonl"));
    const powerhouse = new Powerhouse({
      sessions: new SessionCoordinator(join(dir, "sessions")),
      queue: new TaskQueue(),
      approvals: new ApprovalWorkflow({ timeoutMs: 10_000 }),
      agents: registry,
      memory: new MemoryStore(join(dir, "memory.jsonl")),
      healing,
      planStore: new PlanStore(join(dir, "plans.json")),
      taskStore: new TaskStore(join(dir, "tasks.json")),
      audit,
    });
    const plan = {
      steps: [
        {
          id: "heal",
          kind: "user-message",
          payload: { stimulus: "recover through promoted procedure" },
          maxAttempts: 2,
        },
      ],
    };

    const result = await powerhouse.executeStimulus({ stimulus: `plan: ${JSON.stringify(plan)}` });
    const tasks = powerhouse.listTasks();
    const procedure = healing.getProcedure(promoted!.id);

    expect(result.status).toBe("complete");
    expect(result.response).toContain(`recovered with ${promoted!.id}`);
    expect(result.taskIds).toHaveLength(2);
    expect(tasks[0]?.status).toBe("failed");
    expect(tasks[1]?.status).toBe("complete");
    expect(tasks[1]?.payload.healingProcedureId).toBe(promoted!.id);
    expect(procedure?.uses).toBe(1);
    expect(procedure?.successes).toBe(1);
    expect(procedure?.failures ?? 0).toBe(0);
    expect(audit.list().some((entry) => entry.type === "healing.procedure_applied")).toBe(true);

    powerhouse.stop();
  });

  it("loads dynamic command-backed Pi profiles and approval-gates execution", async () => {
    const dir = tempDir("agentix-dynamic-agent-");
    const agentProfiles = new AgentProfileStore(join(dir, "profiles.json"));
    const script = [
      "let input='';",
      "process.stdin.on('data', chunk => input += chunk);",
      "process.stdin.on('end', () => { const task = JSON.parse(input); console.log(`profile ${task.kind} ${task.payload.value}`); });",
    ].join("");
    agentProfiles.upsert({
      id: "profile-echo",
      kind: "profile-echo",
      enabled: true,
      command: [process.execPath, "-e", script],
      timeoutMs: 10_000,
    });

    const powerhouse = new Powerhouse({
      sessions: new SessionCoordinator(join(dir, "sessions")),
      queue: new TaskQueue(),
      approvals: new ApprovalWorkflow({ timeoutMs: 10_000 }),
      agents: new PIAgentRegistry(),
      memory: new MemoryStore(join(dir, "memory.jsonl")),
      healing: new HealingEngine(join(dir, "healing.json")),
      planStore: new PlanStore(join(dir, "plans.json")),
      taskStore: new TaskStore(join(dir, "tasks.json")),
      audit: new AuditLog(join(dir, "audit.jsonl")),
      agentProfiles,
    });
    const plan = {
      steps: [
        {
          id: "custom",
          kind: "profile-echo",
          payload: { value: "ok" },
          maxAttempts: 1,
        },
      ],
    };

    const result = await powerhouse.executeStimulus({ stimulus: `plan: ${JSON.stringify(plan)}` });
    const pending = powerhouse.listApprovals()[0];
    expect(result.status).toBe("awaiting-approval");
    expect(pending?.kind).toBe("profile-echo");
    expect(pending?.requiresApproval).toBe(true);

    const approved = await powerhouse.approve(pending!.id);

    expect(approved.ok).toBe(true);
    expect(approved.output).toBe("profile profile-echo ok");
    expect(powerhouse.agents.get("profile-echo")?.healthy()).toBe(true);

    powerhouse.stop();
  });

  it("auto-promotes repeated healing procedures and deprecates unsafe ones", async () => {
    const dir = tempDir("agentix-healing-self-evolve-");
    const healing = new HealingEngine(join(dir, "healing.json"));
    healing.observeFailure("seed-1", "seed-session", "known healing failure 4242");
    healing.observeFailure("seed-2", "seed-session", "known healing failure 4242");
    healing.observeFailure("seed-3", "seed-session", "known healing failure 4242");
    const autoPromoted = healing.listProcedures()[0];

    expect(autoPromoted?.status).toBe("promoted");
    expect(autoPromoted?.autoPromotedAt).toBeGreaterThan(0);

    const registry = new PIAgentRegistry();
    registry.register(new HealingResistantAgent());
    const powerhouse = new Powerhouse({
      sessions: new SessionCoordinator(join(dir, "sessions")),
      queue: new TaskQueue(),
      approvals: new ApprovalWorkflow({ timeoutMs: 10_000 }),
      agents: registry,
      memory: new MemoryStore(join(dir, "memory.jsonl")),
      healing,
      planStore: new PlanStore(join(dir, "plans.json")),
      taskStore: new TaskStore(join(dir, "tasks.json")),
      audit: new AuditLog(join(dir, "audit.jsonl")),
    });
    const plan = {
      steps: [
        {
          id: "heal",
          kind: "user-message",
          payload: { stimulus: "try unsafe promoted procedure" },
          maxAttempts: 2,
        },
      ],
    };

    await powerhouse.executeStimulus({ stimulus: `plan: ${JSON.stringify(plan)}` });
    await powerhouse.executeStimulus({ stimulus: `plan: ${JSON.stringify(plan)}` });
    await powerhouse.executeStimulus({ stimulus: `plan: ${JSON.stringify(plan)}` });

    const deprecated = healing.getProcedure(autoPromoted!.id);
    expect(deprecated?.uses).toBe(3);
    expect(deprecated?.successes ?? 0).toBe(0);
    expect(deprecated?.failures).toBe(3);
    expect(deprecated?.status).toBe("deprecated");
    expect(deprecated?.deprecatedReason).toContain("auto-deprecated");

    powerhouse.stop();
  });

  it("consolidates memory into a system record", async () => {
    const powerhouse = makePowerhouse();
    const result = await powerhouse.executeStimulus({ stimulus: "remember this" });

    const record = powerhouse.memory.consolidate(result.sessionId);

    expect(record.role).toBe("system");
    expect(record.tags).toContain("consolidated");
    expect(record.content).toContain("Consolidated");

    powerhouse.stop();
  });

  it("resets Agentix memory by role target", () => {
    const dir = tempDir("agentix-memory-reset-");
    const memory = new MemoryStore(join(dir, "memory.jsonl"));
    memory.add({ sessionId: "session-1", role: "user", content: "user profile", tags: [] });
    memory.add({ sessionId: "session-1", role: "assistant", content: "assistant note", tags: [] });
    memory.add({ sessionId: "session-2", role: "system", content: "system note", tags: [] });

    const userReset = memory.reset({ roles: ["user"] });

    expect(userReset.removed).toBe(1);
    expect(memory.list()).toHaveLength(2);
    expect(memory.list().some((record) => record.role === "user")).toBe(false);

    const sessionReset = memory.reset({ sessionId: "session-1" });

    expect(sessionReset.removed).toBe(1);
    expect(memory.list()).toHaveLength(1);
    expect(memory.list()[0]?.sessionId).toBe("session-2");
  });

  it("retrieves memory by semantic-like token expansion and tags", () => {
    const dir = tempDir("agentix-memory-search-");
    const memory = new MemoryStore(join(dir, "memory.jsonl"));
    const target = memory.add({
      sessionId: "session-1",
      role: "assistant",
      content: "The car cost monitor found a lower supplier rate.",
      tags: ["market-watch"],
    });
    memory.add({
      sessionId: "session-2",
      role: "assistant",
      content: "Unrelated scheduler output.",
      tags: ["cron"],
    });

    const results = memory.search("vehicle pricing market", 5);

    expect(results[0]?.id).toBe(target.id);
    expect(results[0]?.score).toBeGreaterThan(0.4);
    expect(results[0]?.tags).toContain("market-watch");
    expect(results[0]?.sessionId).toBe("session-1");
  });

  it("runs scheduled jobs through Powerhouse", async () => {
    const powerhouse = makePowerhouse();
    const dir = tempDir("agentix-scheduler-");
    const scheduler = new SchedulerService(
      powerhouse,
      new ScheduledJobStore(join(dir, "jobs.json")),
      new AuditLog(join(dir, "audit.jsonl")),
      [dir],
    );
    const job = scheduler.create({
      name: "smoke",
      stimulus: "scheduled hello",
      intervalMs: 60_000,
    });

    const result = await scheduler.runNow(job.id);

    expect(result.ok).toBe(true);
    expect(powerhouse.memory.search("scheduled")).not.toHaveLength(0);

    scheduler.stop();
    powerhouse.stop();
  });

  it("delays the first automatic scheduler tick to protect startup", async () => {
    const powerhouse = makePowerhouse();
    const dir = tempDir("agentix-scheduler-grace-");
    const scheduler = new SchedulerService(
      powerhouse,
      new ScheduledJobStore(join(dir, "jobs.json")),
      new AuditLog(join(dir, "audit.jsonl")),
      [dir],
    );
    const job = scheduler.create({
      name: "startup grace",
      stimulus: "",
      schedule: "every 1m",
      noAgent: true,
    });
    scheduler.jobs.update(job.id, { nextRunAt: Date.now() - 1 });

    scheduler.start(20, 100);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    expect(scheduler.jobs.get(job.id)?.runCount).toBe(0);

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    expect(scheduler.jobs.get(job.id)?.runCount).toBe(1);

    scheduler.stop();
    powerhouse.stop();
  });

  it("supports Hermes-style cron schedules and records run metadata", async () => {
    const powerhouse = makePowerhouse();
    const dir = tempDir("agentix-cron-scheduler-");
    const scheduler = new SchedulerService(
      powerhouse,
      new ScheduledJobStore(join(dir, "jobs.json")),
      new AuditLog(join(dir, "audit.jsonl")),
      [dir],
    );
    const job = scheduler.create({
      name: "cron smoke",
      stimulus: "scheduled cron hello",
      schedule: "*/5 * * * *",
    });

    expect(job.scheduleKind).toBe("cron");
    expect(job.scheduleDisplay).toBe("*/5 * * * *");
    expect(job.nextRunAt).toBeGreaterThan(Date.now());

    const updated = scheduler.update(job.id, { schedule: "every 2m" });
    expect(updated?.scheduleKind).toBe("interval");
    expect(updated?.scheduleDisplay).toBe("every 2m");

    const result = await scheduler.runNow(job.id);
    const persisted = scheduler.jobs.get(job.id);

    expect(result.ok).toBe(true);
    expect(persisted?.lastStatus).toBe("success");
    expect(persisted?.lastTaskIds?.length).toBeGreaterThan(0);
    expect(persisted?.runCount).toBe(1);

    scheduler.stop();
    powerhouse.stop();
  });

  it("completes one-shot scheduled jobs after a manual run", async () => {
    const powerhouse = makePowerhouse();
    const dir = tempDir("agentix-once-scheduler-");
    const scheduler = new SchedulerService(
      powerhouse,
      new ScheduledJobStore(join(dir, "jobs.json")),
      new AuditLog(join(dir, "audit.jsonl")),
      [dir],
    );
    const job = scheduler.create({
      name: "one shot",
      stimulus: "scheduled one shot",
      schedule: "1m",
    });

    const result = await scheduler.runNow(job.id);
    const persisted = scheduler.jobs.get(job.id);

    expect(result.ok).toBe(true);
    expect(persisted?.scheduleKind).toBe("once");
    expect(persisted?.enabled).toBe(false);
    expect(persisted?.nextRunAt).toBeNull();

    scheduler.stop();
    powerhouse.stop();
  });

  it("runs no-agent script cron jobs and stores output", async () => {
    const powerhouse = makePowerhouse();
    const dir = tempDir("agentix-script-scheduler-");
    const script = join(dir, "cron-script.js");
    writeFileSync(script, "console.log('script cron output')\n", "utf-8");
    const scheduler = new SchedulerService(
      powerhouse,
      new ScheduledJobStore(join(dir, "jobs.json")),
      new AuditLog(join(dir, "audit.jsonl")),
      [dir],
    );
    const job = scheduler.create({
      name: "script smoke",
      stimulus: "",
      schedule: "every 1m",
      script,
      noAgent: true,
    });

    const result = await scheduler.runNow(job.id);
    const persisted = scheduler.jobs.get(job.id);

    expect(result.ok).toBe(true);
    expect(persisted?.lastStatus).toBe("success");
    expect(persisted?.lastOutput).toContain("script cron output");
    expect(persisted?.lastTaskIds).toEqual([]);

    scheduler.stop();
    powerhouse.stop();
  });

  it("rejects scheduled scripts outside allowed script directories", async () => {
    const powerhouse = makePowerhouse();
    const dir = tempDir("agentix-script-scheduler-");
    const allowedDir = join(dir, "allowed");
    const outsideDir = join(dir, "outside");
    const script = join(outsideDir, "cron-script.js");
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(script, "console.log('should not run')\n", "utf-8");
    const scheduler = new SchedulerService(
      powerhouse,
      new ScheduledJobStore(join(dir, "jobs.json")),
      new AuditLog(join(dir, "audit.jsonl")),
      [allowedDir],
    );
    const job = scheduler.create({
      name: "script reject smoke",
      stimulus: "",
      schedule: "every 1m",
      script,
      noAgent: true,
    });

    const result = await scheduler.runNow(job.id);
    const persisted = scheduler.jobs.get(job.id);

    expect(result.ok).toBe(false);
    expect(persisted?.lastStatus).toBe("failure");
    expect(persisted?.lastError).toContain("outside allowed script directories");

    scheduler.stop();
    powerhouse.stop();
  });

  it("exposes gateway registry details and accepts inbound gateway messages", async () => {
    const previousWebhookUrl = process.env.AGENTIX_GATEWAY_WEBHOOK_URL;
    let delivered: Record<string, unknown> | null = null;
    const receiver = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        delivered = JSON.parse(body) as Record<string, unknown>;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", () => resolve()));
    const address = receiver.address();
    const port = typeof address === "object" && address ? address.port : 0;
    process.env.AGENTIX_GATEWAY_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
    const runtime = new LocalAgentixRuntime();

    try {
      const gateways = runtime.listGateways();
      expect(gateways.length).toBeGreaterThan(0);
      expect(gateways.find((gateway) => gateway.id === "webhook")?.tokenConfigured).toBe(true);
      const detail = runtime.getGateway("webhook");

      expect(detail).not.toBeNull();
      expect(detail?.gateway.id).toBe("webhook");
      expect(Array.isArray(detail?.relatedSessions)).toBe(true);
      expect(Array.isArray(detail?.relatedTasks)).toBe(true);

      const enabled = runtime.setGatewayEnabled("webhook", true);
      expect(enabled.ok).toBe(true);

      const message = await runtime.receiveGatewayMessage({
        gatewayId: "webhook",
        stimulus: "gateway smoke",
      });
      expect(message.ok).toBe(true);
      expect(message.response).toContain("Powerhouse accepted the task");
      expect(message.delivery).toMatchObject({ attempted: true, ok: true });
      expect(delivered?.gatewayId).toBe("webhook");
      expect(String(delivered?.response)).toContain("Powerhouse accepted the task");

      const inbound = await runtime.receiveGatewayInbound({
        gatewayId: "webhook",
        body: { text: "inbound gateway smoke" },
        secret: "",
      });
      expect(inbound.ok).toBe(false);
      expect(inbound.error).toBe("invalid gateway secret");
    } finally {
      if (previousWebhookUrl === undefined) {
        delete process.env.AGENTIX_GATEWAY_WEBHOOK_URL;
      } else {
        process.env.AGENTIX_GATEWAY_WEBHOOK_URL = previousWebhookUrl;
      }
      runtime.shutdown();
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }
  }, 30_000);

  it("returns detailed scheduled job information", async () => {
    const runtime = new LocalAgentixRuntime();
    const job = runtime.createJob({
      name: "detail smoke",
      stimulus: "scheduled detail",
      intervalMs: 60_000,
    }) as { id: string };

    const detail = runtime.getJob(job.id);

    expect(detail).not.toBeNull();
    expect(detail?.job.id).toBe(job.id);
    expect(Array.isArray(detail?.audit)).toBe(true);
    expect(Array.isArray(detail?.relatedTasks)).toBe(true);

    runtime.shutdown();
  });

  it("creates a support bundle with runtime snapshots", async () => {
    const runtime = new LocalAgentixRuntime();

    await runtime.execute({ stimulus: "support bundle smoke" });
    const bundle = runtime.createSupportBundle() as { bundleDir: string; files: string[] };

    expect(existsSync(join(bundle.bundleDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(bundle.bundleDir, "tasks.json"))).toBe(true);
    expect(existsSync(join(bundle.bundleDir, "plans.json"))).toBe(true);
    expect(existsSync(join(bundle.bundleDir, "doctor.json"))).toBe(true);
    expect(bundle.files).toContain("manifest.json");
    expect(bundle.files).toContain("plans.json");
    expect(bundle.files).toContain("doctor.json");

    const manifest = JSON.parse(readFileSync(join(bundle.bundleDir, "manifest.json"), "utf-8"));
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    expect(manifest.packageName).toBe("agentix");
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.installRoot).toBeTruthy();
    expect(manifest.counts.tasks).toBeGreaterThanOrEqual(1);
    expect(manifest.counts.plans).toBeGreaterThanOrEqual(1);
    expect(manifest.counts.sessions).toBeGreaterThanOrEqual(1);

    runtime.shutdown();
  });
});
