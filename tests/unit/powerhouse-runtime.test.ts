import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    taskStore: new TaskStore(join(dir, "tasks.json")),
    audit: new AuditLog(join(dir, "audit.jsonl")),
  });
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

  it("runtime facade exposes tasks, tools, sessions, and approvals", async () => {
    const runtime = new LocalAgentixRuntime();

    const session = runtime.createSession({ model: "test-model" });
    const result = await runtime.execute({
      sessionId: session.id,
      stimulus: "test runtime facade",
    });

    expect(result.status).toBe("complete");
    expect(runtime.listSessions().some((item) => item.id === session.id)).toBe(true);
    expect(runtime.listTasks(session.id)).toHaveLength(1);
    expect(runtime.listTools().some((tool) => tool.name === "user-message")).toBe(true);
    expect(Array.isArray(runtime.listApprovals())).toBe(true);

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
    expect(Array.isArray(taskSearch.healing)).toBe(true);
    expect(Array.isArray(taskSearch.gateways)).toBe(true);
    expect(taskSearch.tasks.length).toBeGreaterThan(0);
    expect(sessionSearch.sessions.some((item) => item.id === session.id)).toBe(true);

    runtime.shutdown();
  });

  it("deletes sessions through the runtime facade", async () => {
    const runtime = new LocalAgentixRuntime();

    const session = runtime.createSession({ model: "test-model" });
    expect(runtime.listSessions().some((item) => item.id === session.id)).toBe(true);

    runtime.deleteSession(session.id);

    expect(runtime.listSessions().some((item) => item.id === session.id)).toBe(false);

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

    const restarted = runtime.controlTask(taskId, "restart");
    expect(restarted.ok).toBe(true);
    expect(restarted.output).toMatchObject({ action: "restart", taskId });

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

  it("persists tasks for recovery and API listing", async () => {
    const dir = tempDir("agentix-persist-");
    const taskStore = new TaskStore(join(dir, "tasks.json"));
    const powerhouse = new Powerhouse({
      sessions: new SessionCoordinator(join(dir, "sessions")),
      queue: new TaskQueue(),
      approvals: new ApprovalWorkflow({ timeoutMs: 10_000 }),
      memory: new MemoryStore(join(dir, "memory.jsonl")),
      healing: new HealingEngine(join(dir, "healing.json")),
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

    await powerhouse.executeStimulus({ stimulus: "sandbox: process.exit(1)" });
    await powerhouse.executeStimulus({ stimulus: "sandbox: process.exit(1)" });

    const procedures = powerhouse.healing.listProcedures();
    expect(procedures.some((procedure) => procedure.status === "candidate")).toBe(true);

    const promoted = powerhouse.healing.promoteProcedure(procedures[0]!.id);
    expect(promoted?.status).toBe("promoted");

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

  it("runs scheduled jobs through Powerhouse", async () => {
    const powerhouse = makePowerhouse();
    const dir = tempDir("agentix-scheduler-");
    const scheduler = new SchedulerService(
      powerhouse,
      new ScheduledJobStore(join(dir, "jobs.json")),
      new AuditLog(join(dir, "audit.jsonl")),
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

  it("exposes gateway registry details and accepts inbound gateway messages", async () => {
    const runtime = new LocalAgentixRuntime();

    const gateways = runtime.listGateways();
    expect(gateways.length).toBeGreaterThan(0);
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

    runtime.shutdown();
  });

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
    expect(bundle.files).toContain("manifest.json");

    const manifest = JSON.parse(readFileSync(join(bundle.bundleDir, "manifest.json"), "utf-8"));
    expect(manifest.counts.tasks).toBeGreaterThanOrEqual(1);
    expect(manifest.counts.sessions).toBeGreaterThanOrEqual(1);

    runtime.shutdown();
  });
});
