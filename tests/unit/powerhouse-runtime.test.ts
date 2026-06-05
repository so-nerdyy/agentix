import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
    expect(runtime.listApprovals()).toHaveLength(0);

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
});
