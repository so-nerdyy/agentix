import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
import { SkillRegistry } from "../../src/powerhouse/SkillRegistry.js";
import { LocalAgentixRuntime } from "../../src/runtime/LocalAgentixRuntime.js";
import { TaskStore } from "../../src/powerhouse/TaskStore.js";
import { SchedulerService } from "../../src/scheduler/SchedulerService.js";
import { ScheduledJobStore } from "../../src/scheduler/ScheduledJobStore.js";
import { PlanStore } from "../../src/symphony/PlanStore.js";
import type { SymphonyPlan } from "../../src/symphony/types.js";
import { resetConfigCache } from "../../src/config/index.js";
import { RuntimeLogStore } from "../../src/logging/RuntimeLogStore.js";
import type { Task, TaskResult } from "../../src/powerhouse/types.js";

const tempDirs: string[] = [];

function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  tempDirs.push(dir);
  return dir;
}

function makePowerhouse(
  agent: BasePIAgent = new ConversationAgent(),
  skills?: SkillRegistry,
): Powerhouse {
  const dir = tempDir("agentix-powerhouse-");
  const registry = new PIAgentRegistry();
  registry.register(agent);

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
    skills,
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

class CancellableAgent extends BasePIAgent {
  readonly started: Promise<void>;
  private markStarted!: () => void;

  constructor() {
    super("user-message", "pi-cancellable-test");
    this.started = new Promise((resolve) => {
      this.markStarted = resolve;
    });
  }

  async execute(task: Task, context: { signal?: AbortSignal } = {}): Promise<TaskResult> {
    this.emitStart(task);
    this.markStarted();
    return await new Promise<TaskResult>((resolve) => {
      const onAbort = () => {
        const result = { ok: false, error: "cancelled by test" };
        this.emitError(task, result.error);
        resolve(result);
      };
      if (context.signal?.aborted) {
        onAbort();
        return;
      }
      context.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

class ThrowingAgent extends BasePIAgent {
  constructor() {
    super("user-message", "pi-throwing-test");
  }

  async execute(task: Task): Promise<TaskResult> {
    this.emitStart(task);
    throw new Error("synthetic Pi crash");
  }
}

class RecoveryAgent extends BasePIAgent {
  readonly calls: Array<{ stepId: string | undefined; context: string }> = [];

  constructor() {
    super("user-message", "pi-recovery-test");
  }

  async execute(task: Task): Promise<TaskResult> {
    this.emitStart(task);
    this.calls.push({
      stepId: task.stepId,
      context: String(task.payload.context ?? ""),
    });
    const result = { ok: true, output: `${task.stepId}-recovered-output` };
    this.emitComplete(task, result);
    return result;
  }
}

class RetryPlanAgent extends BasePIAgent {
  private failedOnce = false;

  constructor() {
    super("user-message", "pi-retry-plan-test");
  }

  async execute(task: Task): Promise<TaskResult> {
    this.emitStart(task);
    if (task.stepId === "flaky" && !this.failedOnce) {
      this.failedOnce = true;
      const error = "transient plan failure";
      this.emitError(task, error);
      return { ok: false, error };
    }
    const result = { ok: true, output: `${task.stepId}-success` };
    this.emitComplete(task, result);
    return result;
  }
}

beforeEach(() => {
  process.env.AGENTIX_PROVIDER = "openai";
  process.env.AGENTIX_MODEL = "test-model";
  process.env.AGENTIX_LLM_API_KEY = "test-key";
  resetConfigCache();
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/chat/completions") || url.endsWith("/messages")) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: [
          "Agentix is running with the Agentix shell and backend.",
          "Powerhouse accepted the task.",
          "Symphony planned the task.",
          "A Pi agent executed the selected step.",
        ].join("\n") } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return nativeFetch(input, init);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENTIX_PROVIDER;
  delete process.env.AGENTIX_MODEL;
  delete process.env.AGENTIX_BASE_URL;
  delete process.env.AGENTIX_LLM_API_KEY;
  delete process.env.AGENTIX_SESSION_TOKEN;
  delete process.env.AGENTIX_LUNA_MODEL;
  delete process.env.AGENTIX_TERRA_MODEL;
  resetConfigCache();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("Powerhouse restored runtime", () => {
  it("executes a normal Agentix message through Symphony and a Pi agent", async () => {
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

  it("honors per-invocation model and provider selectors during conversation execution", async () => {
    process.env.AGENTIX_PROVIDER = "local";
    process.env.AGENTIX_MODEL = "env-model";
    process.env.AGENTIX_BASE_URL = "http://local.invalid/v1";
    resetConfigCache();
    let requestBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "selected model response" } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const powerhouse = makePowerhouse();

    const result = await powerhouse.executeStimulus({
      stimulus: "hello selected model",
      model: "cli-model",
      provider: "local",
      baseUrl: "http://override.invalid/v1",
      toolsets: ["web"],
    });

    expect(result.status).toBe("complete");
    expect(result.response).toContain("selected model response");
    expect(requestBody?.model).toBe("cli-model");
    expect(powerhouse.listSessions()[0]?.metadata).toMatchObject({
      model: "cli-model",
      provider: "local",
      baseUrl: "http://override.invalid/v1",
      toolsets: ["web"],
    });

    powerhouse.stop();
  });

  it("injects only explicitly enabled Agentix skills into Pi prompts", async () => {
    const dir = tempDir("agentix-skills-");
    const skills = new SkillRegistry(join(dir, "skills.json"));
    const discovered = skills.list("apple-notes").find((skill) => skill.id === "apple-notes");
    expect(discovered).toBeDefined();
    expect(discovered?.enabled).toBe(false);
    expect(skills.setEnabled("apple-notes", true)?.enabled).toBe(true);

    const systemPrompts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      systemPrompts.push(String(body.messages?.find((message) => message.role === "system")?.content ?? ""));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "skill prompt response" } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const powerhouse = makePowerhouse(new ConversationAgent(), skills);

    const enabled = await powerhouse.executeStimulus({ stimulus: "create an Apple note" });
    expect(enabled.status).toBe("complete");
    expect(powerhouse.listTasks()[0]?.payload.activeSkills).toEqual(["apple-notes"]);
    expect(systemPrompts.at(-1)).toContain('<agentix-skill name="apple-notes">');
    expect(systemPrompts.at(-1)).toContain("Manage Apple Notes");

    expect(skills.setEnabled("apple-notes", false)?.enabled).toBe(false);
    await powerhouse.executeStimulus({ stimulus: "answer without a skill" });
    expect(systemPrompts.at(-1)).not.toContain("<agentix-skill");
    expect(powerhouse.audit.list().some((entry) => entry.type === "session.created")).toBe(true);
    powerhouse.stop();
  });

  it("fails the task when the configured provider rejects authentication", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: "invalid credential detail must stay private" },
    }), { status: 401, statusText: "Unauthorized" }));
    vi.stubGlobal("fetch", fetchMock);
    const powerhouse = makePowerhouse();

    const result = await powerhouse.executeStimulus({ stimulus: "do not fake success" });

    expect(result.status).toBe("failed");
    expect(result.response).toContain("authentication failed");
    expect(result.response).not.toContain("invalid credential detail");
    expect(result.response).not.toContain("Powerhouse accepted the task");
    expect(powerhouse.listTasks()[0]?.status).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    powerhouse.stop();
  });

  it("executes configured Luna and Terra models as first-class Pi agents", async () => {
    process.env.AGENTIX_LUNA_MODEL = "luna-worker-model";
    process.env.AGENTIX_TERRA_MODEL = "terra-worker-model";
    resetConfigCache();
    const requestedModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      requestedModels.push(String(body.model));
      return new Response(JSON.stringify({
        choices: [{ message: { content: `delegate response from ${body.model}` } }],
      }), { status: 200 });
    }));
    const powerhouse = makePowerhouse();

    const luna = await powerhouse.executeStimulus({ stimulus: "luna: review this focused change" });
    const terra = await powerhouse.executeStimulus({ stimulus: "terra: redesign this architecture" });
    const tasks = powerhouse.listTasks();

    expect(luna).toMatchObject({ status: "complete" });
    expect(luna.response).toContain("luna-worker-model");
    expect(terra).toMatchObject({ status: "complete" });
    expect(terra.response).toContain("terra-worker-model");
    expect(tasks.map((task) => task.kind)).toEqual(["luna-message", "terra-message"]);
    expect(requestedModels).toEqual(["luna-worker-model", "terra-worker-model"]);
    expect(powerhouse.agents.forKind("luna-message")?.id).toBe("pi-luna");
    expect(powerhouse.agents.forKind("terra-message")?.id).toBe("pi-terra");
    powerhouse.stop();
  });

  it("aborts an active Pi task and preserves cancelled as its terminal state", async () => {
    const agent = new CancellableAgent();
    const powerhouse = makePowerhouse(agent);

    const execution = powerhouse.executeStimulus({
      stimulus: `plan: ${JSON.stringify({
        steps: [{
          id: "cancelled-step",
          kind: "user-message",
          payload: { stimulus: "wait until cancelled" },
          maxAttempts: 3,
        }],
      })}`,
    });
    await agent.started;
    const taskId = powerhouse.listTasks()[0]?.id;
    expect(taskId).toBeDefined();

    const cancellation = await powerhouse.controlTask(taskId!, "cancel");
    const result = await execution;

    expect(cancellation).toMatchObject({
      ok: true,
      output: { action: "cancel", taskId, status: "cancelled" },
    });
    expect(result.status).toBe("cancelled");
    expect(powerhouse.taskStore.get(taskId!)?.status).toBe("cancelled");
    expect(powerhouse.planStore.list()[0]?.status).toBe("cancelled");
    expect(powerhouse.audit.list().filter((entry) => entry.type === "task.cancelled")).toHaveLength(1);
    expect(powerhouse.audit.list().filter((entry) => entry.type === "plan.cancelled")).toHaveLength(1);
    expect(powerhouse.audit.list().some((entry) => entry.type === "task.completed")).toBe(false);
    expect(powerhouse.taskStore.list()).toHaveLength(1);
    powerhouse.stop();
  });

  it("closes an approval-waiting plan when its task is cancelled directly", async () => {
    const powerhouse = makePowerhouse();
    const paused = await powerhouse.executeStimulus({ stimulus: "run: echo should-not-run" });
    const taskId = paused.taskIds[0]!;

    expect(paused.status).toBe("awaiting-approval");
    const cancellation = await powerhouse.controlTask(taskId, "cancel");

    expect(cancellation.ok).toBe(true);
    expect(powerhouse.taskStore.get(taskId)?.status).toBe("cancelled");
    expect(powerhouse.planStore.list()[0]?.status).toBe("cancelled");
    expect(powerhouse.listApprovals()).toHaveLength(0);
    powerhouse.stop();
  });

  it("propagates an interrupted request through Symphony and the active Pi task", async () => {
    const agent = new CancellableAgent();
    const powerhouse = makePowerhouse(agent);
    const controller = new AbortController();

    const execution = powerhouse.executeStimulus({
      stimulus: "cancel the complete orchestration request",
      signal: controller.signal,
    });
    await agent.started;
    controller.abort(new Error("terminal client disconnected"));
    const result = await execution;
    const task = powerhouse.taskStore.list()[0];
    const plan = powerhouse.planStore.list()[0];

    expect(result.status).toBe("cancelled");
    expect(result.response).toBe("Agentix execution cancelled.");
    expect(task).toMatchObject({ status: "cancelled", error: "cancelled by interrupted request" });
    expect(plan).toMatchObject({ status: "cancelled", taskIds: [task!.id] });
    expect(powerhouse.audit.list().filter((entry) => entry.type === "task.cancelled")).toHaveLength(1);
    expect(powerhouse.audit.list().some((entry) => entry.type === "task.completed")).toBe(false);
    powerhouse.stop();
  });

  it("checkpoints active work on shutdown and resumes it after restart", async () => {
    const dir = tempDir("agentix-shutdown-recovery-");
    const sessions = new SessionCoordinator(join(dir, "sessions"));
    const taskStore = new TaskStore(join(dir, "tasks.json"));
    const planStore = new PlanStore(join(dir, "plans.json"));
    const memory = new MemoryStore(join(dir, "memory.jsonl"));
    const healing = new HealingEngine(join(dir, "healing.json"));
    const audit = new AuditLog(join(dir, "audit.jsonl"));
    const makePersistent = (agent: BasePIAgent) => {
      const registry = new PIAgentRegistry();
      registry.register(agent);
      return new Powerhouse({
        sessions,
        queue: new TaskQueue(),
        approvals: new ApprovalWorkflow({ timeoutMs: 10_000 }),
        agents: registry,
        memory,
        healing,
        planStore,
        taskStore,
        audit,
      });
    };
    const blockingAgent = new CancellableAgent();
    const first = makePersistent(blockingAgent);

    const inFlight = first.executeStimulus({ stimulus: "survive graceful shutdown" });
    await blockingAgent.started;
    const taskId = first.listTasks()[0]?.id;
    const planId = first.planStore.list()[0]?.plan.id;
    expect(taskId).toBeDefined();
    expect(planId).toBeDefined();

    first.stop();
    await inFlight;

    expect(taskStore.get(taskId!)?.status).toBe("queued");
    expect(planStore.get(planId!)?.status).toBe("running");
    expect(audit.list().some((entry) => entry.type === "task.interrupted")).toBe(true);

    const restarted = makePersistent(new RecoveryAgent());
    restarted.start();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (planStore.get(planId!)?.status === "complete") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(taskStore.get(taskId!)?.status).toBe("complete");
    expect(planStore.get(planId!)?.status).toBe("complete");
    restarted.stop();
  });

  it("turns a thrown Pi exception into persisted task and plan failure", async () => {
    const powerhouse = makePowerhouse(new ThrowingAgent());

    const result = await powerhouse.executeStimulus({ stimulus: "trigger a Pi crash" });
    const task = powerhouse.listTasks()[0];
    const plan = powerhouse.planStore.list()[0];

    expect(result.status).toBe("failed");
    expect(result.response).toContain("synthetic Pi crash");
    expect(task).toMatchObject({ status: "failed", error: "synthetic Pi crash" });
    expect(powerhouse.taskStore.get(task!.id)).toMatchObject({
      status: "failed",
      error: "synthetic Pi crash",
    });
    expect(plan).toMatchObject({ status: "failed", taskIds: [task!.id] });
    expect(powerhouse.audit.list().some((entry) => entry.type === "task.failed")).toBe(true);
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

  it("recovers pending approvals before a fresh control-plane read or decision", async () => {
    const dir = tempDir("agentix-approval-restart-");
    const makePersistentPowerhouse = () => new Powerhouse({
      sessions: new SessionCoordinator(join(dir, "sessions")),
      queue: new TaskQueue(),
      approvals: new ApprovalWorkflow({ timeoutMs: 10_000 }),
      memory: new MemoryStore(join(dir, "memory.jsonl")),
      healing: new HealingEngine(join(dir, "healing.json")),
      planStore: new PlanStore(join(dir, "plans.json")),
      taskStore: new TaskStore(join(dir, "tasks.json")),
      audit: new AuditLog(join(dir, "audit.jsonl")),
    });
    const first = makePersistentPowerhouse();
    const created = await first.executeStimulus({ stimulus: "run: echo approval-restart" });
    const taskId = created.taskIds[0]!;
    first.stop();

    const restarted = makePersistentPowerhouse();
    try {
      expect(restarted.listApprovals().map((task) => task.id)).toContain(taskId);

      const approved = await restarted.approve(taskId);
      expect(approved.ok).toBe(true);
      expect(JSON.stringify(approved.output)).toContain("approval-restart");
      expect(restarted.listTasks().find((task) => task.id === taskId)?.status).toBe("complete");
    } finally {
      restarted.stop();
    }
  });

  it("controls persisted terminal tasks after the Powerhouse process restarts", async () => {
    const dir = tempDir("agentix-task-control-restart-");
    const makePersistentPowerhouse = () => new Powerhouse({
      sessions: new SessionCoordinator(join(dir, "sessions")),
      queue: new TaskQueue(),
      approvals: new ApprovalWorkflow({ timeoutMs: 10_000 }),
      memory: new MemoryStore(join(dir, "memory.jsonl")),
      healing: new HealingEngine(join(dir, "healing.json")),
      planStore: new PlanStore(join(dir, "plans.json")),
      taskStore: new TaskStore(join(dir, "tasks.json")),
      audit: new AuditLog(join(dir, "audit.jsonl")),
    });
    const first = makePersistentPowerhouse();
    const created = await first.executeStimulus({ stimulus: "run: echo persisted-control" });
    const taskId = created.taskIds[0]!;
    expect(first.reject(taskId, "prepare persisted rejection")).toBe(true);
    first.stop();

    const restarted = makePersistentPowerhouse();
    try {
      const retried = await restarted.controlTask(taskId, "retry");
      expect(retried.ok).toBe(true);
      expect(restarted.listTasks().find((task) => task.id === taskId)?.status).toBe("awaiting-approval");

      const cancelled = await restarted.controlTask(taskId, "cancel");
      expect(cancelled.ok).toBe(true);
      expect(restarted.listTasks().find((task) => task.id === taskId)?.status).toBe("cancelled");

      const restartedTask = await restarted.controlTask(taskId, "restart");
      expect(restartedTask.ok).toBe(true);
      expect(restarted.listTasks().find((task) => task.id === taskId)?.status).toBe("awaiting-approval");
      expect(restarted.reject(taskId, "cleanup persisted control test")).toBe(true);
    } finally {
      restarted.stop();
    }
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
      expect(powerhouse.planStore.list()[0]?.status).toBe("cancelled");
      expect(powerhouse.audit.list().some((entry) => entry.type === "approval.timeout_rejected")).toBe(true);
      expect(
        powerhouse.audit.list().some((entry) => entry.type === "plan.cancelled_after_approval_rejection"),
      ).toBe(true);
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
    expect(runtime.getSession(session.id)?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(runtime.listTasks(session.id)).toHaveLength(1);
    const sessionPlans = runtime.listPlans().filter((plan) => plan.sessionId === session.id);
    expect(sessionPlans).toHaveLength(1);
    expect(runtime.getPlan(String(sessionPlans[0]?.id))?.steps).toHaveLength(1);
    const replayedPlan = await runtime.controlPlan(String(sessionPlans[0]?.id), "replay");
    expect(replayedPlan.ok).toBe(true);
    expect(JSON.stringify(replayedPlan)).toContain("sourcePlanId");
    const cancelledPlan = await runtime.controlPlan(String(sessionPlans[0]?.id), "cancel");
    expect(cancelledPlan).toMatchObject({ ok: false, action: "cancel", status: "complete" });
    expect(String(cancelledPlan.error)).toContain("plan cannot be cancelled from complete");
    expect(runtime.listMemory(session.id).some((item) => String(item.content).includes("test runtime facade"))).toBe(true);
    expect(runtime.listTools().some((tool) => tool.name === "user-message")).toBe(true);
    expect(Array.isArray(runtime.listApprovals())).toBe(true);
    const doctor = runtime.doctor();
    expect(String(doctor.status)).toMatch(/pass|warn|fail/);
    expect(Array.isArray(doctor.checks)).toBe(true);
    expect((doctor.checks as Array<{ id: string }>).some((check) => check.id === "sandbox.isolation")).toBe(true);
    expect((doctor.checks as Array<{ id: string }>).some((check) => check.id === "install.assets")).toBe(true);
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { name: string; version: string };
    expect((doctor.install as { packageName?: string; packageVersion?: string }).packageName).toBe(pkg.name);
    expect((doctor.install as { packageName?: string; packageVersion?: string }).packageVersion).toMatch(/\d+\.\d+\.\d+/);
    const readiness = runtime.readiness() as {
      status: string;
      privateBetaReady: boolean;
      publicReleaseReady: boolean;
      gates: Array<{ id: string; status: string }>;
      externalRequirements: Array<{ id: string }>;
    };
    expect(readiness.status).toMatch(/ready|not-ready/);
    expect(typeof readiness.privateBetaReady).toBe("boolean");
    expect(typeof readiness.publicReleaseReady).toBe("boolean");
    expect(readiness.gates.some((gate) => gate.id === "backend.pi_agents")).toBe(true);
    expect(readiness.externalRequirements.some((item) => item.id === "release.publish")).toBe(true);
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

  it("accepts a verified public-release proof file for readiness", () => {
    const dir = tempDir("agentix-release-proof-");
    const proofPath = join(dir, "proof.json");
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { name: string; version: string };
    const artifactBase = pkg.name.replace(/^@/, "").replace(/[\/\\]/g, "-");
    const previousProof = process.env.AGENTIX_PUBLIC_RELEASE_PROOF;
    process.env.AGENTIX_PUBLIC_RELEASE_PROOF = proofPath;
    writeFileSync(proofPath, JSON.stringify({
      ok: true,
      package: pkg.name,
      version: pkg.version,
      installerDryRun: true,
      verifiedAt: new Date().toISOString(),
      release: {
        sha256: "abc123",
        manifestUrl: `https://example.test/${artifactBase}-${pkg.version}-manifest.json`,
        tarballUrl: `https://example.test/${artifactBase}-${pkg.version}.tgz`,
      },
      npm: {
        tarball: `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/-/${artifactBase}-${pkg.version}.tgz`,
        attestations: {
          url: `https://registry.npmjs.org/-/npm/v1/attestations/${encodeURIComponent(pkg.name)}@${pkg.version}`,
          predicateType: "https://slsa.dev/provenance/v1",
          provenance: true,
        },
      },
      npmInstall: {
        agentixVersion: `Agentix v${pkg.version}`,
        helpChecked: true,
      },
    }), "utf-8");
    const runtime = new LocalAgentixRuntime();

    try {
      const readiness = runtime.readiness() as {
        gates: Array<{ id: string; status: string }>;
        releaseProof: { ok: boolean; path: string };
      };

      expect(readiness.releaseProof).toMatchObject({ ok: true, path: proofPath });
      expect(readiness.gates.find((gate) => gate.id === "release.publish")?.status).toBe("pass");
    } finally {
      runtime.shutdown();
      if (previousProof === undefined) {
        delete process.env.AGENTIX_PUBLIC_RELEASE_PROOF;
      } else {
        process.env.AGENTIX_PUBLIC_RELEASE_PROOF = previousProof;
      }
    }
  });

  it("rejects public-release proof files that skip npm registry verification", () => {
    const dir = tempDir("agentix-release-proof-no-npm-");
    const proofPath = join(dir, "proof.json");
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { name: string; version: string };
    const artifactBase = pkg.name.replace(/^@/, "").replace(/[\/\\]/g, "-");
    const previousProof = process.env.AGENTIX_PUBLIC_RELEASE_PROOF;
    process.env.AGENTIX_PUBLIC_RELEASE_PROOF = proofPath;
    writeFileSync(proofPath, JSON.stringify({
      ok: true,
      package: pkg.name,
      version: pkg.version,
      installerDryRun: true,
      verifiedAt: new Date().toISOString(),
      release: {
        sha256: "abc123",
        manifestUrl: `https://example.test/${artifactBase}-${pkg.version}-manifest.json`,
        tarballUrl: `https://example.test/${artifactBase}-${pkg.version}.tgz`,
      },
    }), "utf-8");
    const runtime = new LocalAgentixRuntime();

    try {
      const readiness = runtime.readiness() as {
        gates: Array<{ id: string; status: string; detail: string }>;
        releaseProof: { ok: boolean; detail: string };
      };

      expect(readiness.releaseProof).toMatchObject({
        ok: false,
        detail: "proof missing npm registry metadata",
      });
      expect(readiness.gates.find((gate) => gate.id === "release.publish")?.status).toBe("block");
    } finally {
      runtime.shutdown();
      if (previousProof === undefined) {
        delete process.env.AGENTIX_PUBLIC_RELEASE_PROOF;
      } else {
        process.env.AGENTIX_PUBLIC_RELEASE_PROOF = previousProof;
      }
    }
  });

  it("rejects public-release proof files that skip npm global install verification", () => {
    const dir = tempDir("agentix-release-proof-no-install-");
    const proofPath = join(dir, "proof.json");
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { name: string; version: string };
    const artifactBase = pkg.name.replace(/^@/, "").replace(/[\/\\]/g, "-");
    const previousProof = process.env.AGENTIX_PUBLIC_RELEASE_PROOF;
    process.env.AGENTIX_PUBLIC_RELEASE_PROOF = proofPath;
    writeFileSync(proofPath, JSON.stringify({
      ok: true,
      package: pkg.name,
      version: pkg.version,
      installerDryRun: true,
      verifiedAt: new Date().toISOString(),
      release: {
        sha256: "abc123",
        manifestUrl: `https://example.test/${artifactBase}-${pkg.version}-manifest.json`,
        tarballUrl: `https://example.test/${artifactBase}-${pkg.version}.tgz`,
      },
      npm: {
        tarball: `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/-/${artifactBase}-${pkg.version}.tgz`,
        attestations: {
          url: `https://registry.npmjs.org/-/npm/v1/attestations/${encodeURIComponent(pkg.name)}@${pkg.version}`,
          predicateType: "https://slsa.dev/provenance/v1",
          provenance: true,
        },
      },
    }), "utf-8");
    const runtime = new LocalAgentixRuntime();

    try {
      const readiness = runtime.readiness() as {
        gates: Array<{ id: string; status: string; detail: string }>;
        releaseProof: { ok: boolean; detail: string };
      };

      expect(readiness.releaseProof).toMatchObject({
        ok: false,
        detail: "proof missing npm global install verification",
      });
      expect(readiness.gates.find((gate) => gate.id === "release.publish")?.status).toBe("block");
    } finally {
      runtime.shutdown();
      if (previousProof === undefined) {
        delete process.env.AGENTIX_PUBLIC_RELEASE_PROOF;
      } else {
        process.env.AGENTIX_PUBLIC_RELEASE_PROOF = previousProof;
      }
    }
  });

  it("rejects public-release proof files that skip npm provenance verification", () => {
    const dir = tempDir("agentix-release-proof-no-provenance-");
    const proofPath = join(dir, "proof.json");
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { name: string; version: string };
    const artifactBase = pkg.name.replace(/^@/, "").replace(/[\/\\]/g, "-");
    const previousProof = process.env.AGENTIX_PUBLIC_RELEASE_PROOF;
    process.env.AGENTIX_PUBLIC_RELEASE_PROOF = proofPath;
    writeFileSync(proofPath, JSON.stringify({
      ok: true,
      package: pkg.name,
      version: pkg.version,
      installerDryRun: true,
      verifiedAt: new Date().toISOString(),
      release: {
        sha256: "abc123",
        manifestUrl: `https://example.test/${artifactBase}-${pkg.version}-manifest.json`,
        tarballUrl: `https://example.test/${artifactBase}-${pkg.version}.tgz`,
      },
      npm: {
        tarball: `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/-/${artifactBase}-${pkg.version}.tgz`,
      },
      npmInstall: {
        agentixVersion: `Agentix v${pkg.version}`,
        helpChecked: true,
      },
    }), "utf-8");
    const runtime = new LocalAgentixRuntime();

    try {
      const readiness = runtime.readiness() as {
        gates: Array<{ id: string; status: string; detail: string }>;
        releaseProof: { ok: boolean; detail: string };
      };

      expect(readiness.releaseProof).toMatchObject({
        ok: false,
        detail: "proof missing npm provenance attestation verification",
      });
      expect(readiness.gates.find((gate) => gate.id === "release.publish")?.status).toBe("block");
    } finally {
      runtime.shutdown();
      if (previousProof === undefined) {
        delete process.env.AGENTIX_PUBLIC_RELEASE_PROOF;
      } else {
        process.env.AGENTIX_PUBLIC_RELEASE_PROOF = previousProof;
      }
    }
  });

  it("accepts a verified live-LLM proof file for readiness", () => {
    const dir = tempDir("agentix-llm-proof-");
    const proofPath = join(dir, "proof.json");
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { name: string; version: string };
    const previousProof = process.env.AGENTIX_LLM_PROOF;
    process.env.AGENTIX_LLM_PROOF = proofPath;
    writeFileSync(proofPath, JSON.stringify({
      ok: true,
      package: pkg.name,
      version: pkg.version,
      verifiedAt: new Date().toISOString(),
      provider: "openai",
      model: "gpt-release-smoke",
      endpoint: "https://api.openai.com/v1/chat/completions",
      responseChars: 16,
    }), "utf-8");
    const runtime = new LocalAgentixRuntime();

    try {
      const readiness = runtime.readiness() as {
        gates: Array<{ id: string; status: string }>;
        llmProof: { ok: boolean; path: string };
      };

      expect(readiness.llmProof).toMatchObject({ ok: true, path: proofPath });
      expect(readiness.gates.find((gate) => gate.id === "llm.live_key")?.status).toBe("pass");
    } finally {
      runtime.shutdown();
      if (previousProof === undefined) {
        delete process.env.AGENTIX_LLM_PROOF;
      } else {
        process.env.AGENTIX_LLM_PROOF = previousProof;
      }
    }
  });

  it("reports public-release readiness when release and live-LLM proofs are present", () => {
    const dir = tempDir("agentix-public-ready-");
    const releaseProofPath = join(dir, "release-proof.json");
    const llmProofPath = join(dir, "llm-proof.json");
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { name: string; version: string };
    const artifactBase = pkg.name.replace(/^@/, "").replace(/[\/\\]/g, "-");
    const previousReleaseProof = process.env.AGENTIX_PUBLIC_RELEASE_PROOF;
    const previousLlmProof = process.env.AGENTIX_LLM_PROOF;
    process.env.AGENTIX_PUBLIC_RELEASE_PROOF = releaseProofPath;
    process.env.AGENTIX_LLM_PROOF = llmProofPath;
    writeFileSync(releaseProofPath, JSON.stringify({
      ok: true,
      package: pkg.name,
      version: pkg.version,
      installerDryRun: true,
      verifiedAt: new Date().toISOString(),
      release: {
        sha256: "abc123",
        manifestUrl: `https://example.test/${artifactBase}-${pkg.version}-manifest.json`,
        tarballUrl: `https://example.test/${artifactBase}-${pkg.version}.tgz`,
      },
      npm: {
        tarball: `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/-/${artifactBase}-${pkg.version}.tgz`,
        attestations: {
          url: `https://registry.npmjs.org/-/npm/v1/attestations/${encodeURIComponent(pkg.name)}@${pkg.version}`,
          predicateType: "https://slsa.dev/provenance/v1",
          provenance: true,
        },
      },
      npmInstall: {
        agentixVersion: `Agentix v${pkg.version}`,
        helpChecked: true,
      },
    }), "utf-8");
    writeFileSync(llmProofPath, JSON.stringify({
      ok: true,
      package: pkg.name,
      version: pkg.version,
      verifiedAt: new Date().toISOString(),
      provider: "openai",
      model: "gpt-release-smoke",
      endpoint: "https://api.openai.com/v1/chat/completions",
      responseChars: 16,
    }), "utf-8");
    const runtime = new LocalAgentixRuntime();

    try {
      const readiness = runtime.readiness() as {
        status: string;
        publicReleaseReady: boolean;
      };

      expect(readiness.status).toBe("public-release-ready");
      expect(readiness.publicReleaseReady).toBe(true);
    } finally {
      runtime.shutdown();
      if (previousReleaseProof === undefined) {
        delete process.env.AGENTIX_PUBLIC_RELEASE_PROOF;
      } else {
        process.env.AGENTIX_PUBLIC_RELEASE_PROOF = previousReleaseProof;
      }
      if (previousLlmProof === undefined) {
        delete process.env.AGENTIX_LLM_PROOF;
      } else {
        process.env.AGENTIX_LLM_PROOF = previousLlmProof;
      }
    }
  });

  it("does not accept environment flags as public-release proof", () => {
    const previousReleaseFlag = process.env.AGENTIX_PUBLIC_RELEASE_VERIFIED;
    const previousLlmFlag = process.env.AGENTIX_LLM_LIVE_VERIFIED;
    const previousReleaseProof = process.env.AGENTIX_PUBLIC_RELEASE_PROOF;
    const previousLlmProof = process.env.AGENTIX_LLM_PROOF;
    process.env.AGENTIX_PUBLIC_RELEASE_VERIFIED = "1";
    process.env.AGENTIX_LLM_LIVE_VERIFIED = "1";
    delete process.env.AGENTIX_PUBLIC_RELEASE_PROOF;
    delete process.env.AGENTIX_LLM_PROOF;
    const runtime = new LocalAgentixRuntime();

    try {
      const readiness = runtime.readiness() as {
        publicReleaseReady: boolean;
        gates: Array<{ id: string; status: string }>;
      };

      expect(readiness.publicReleaseReady).toBe(false);
      expect(readiness.gates.find((gate) => gate.id === "llm.live_key")?.status).toBe("block");
      expect(readiness.gates.find((gate) => gate.id === "release.publish")?.status).toBe("block");
    } finally {
      runtime.shutdown();
      if (previousReleaseFlag === undefined) {
        delete process.env.AGENTIX_PUBLIC_RELEASE_VERIFIED;
      } else {
        process.env.AGENTIX_PUBLIC_RELEASE_VERIFIED = previousReleaseFlag;
      }
      if (previousLlmFlag === undefined) {
        delete process.env.AGENTIX_LLM_LIVE_VERIFIED;
      } else {
        process.env.AGENTIX_LLM_LIVE_VERIFIED = previousLlmFlag;
      }
      if (previousReleaseProof === undefined) {
        delete process.env.AGENTIX_PUBLIC_RELEASE_PROOF;
      } else {
        process.env.AGENTIX_PUBLIC_RELEASE_PROOF = previousReleaseProof;
      }
      if (previousLlmProof === undefined) {
        delete process.env.AGENTIX_LLM_PROOF;
      } else {
        process.env.AGENTIX_LLM_PROOF = previousLlmProof;
      }
    }
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

    const session = runtime.createSession({
      model: "test-model",
      messages: [
        { role: "user", content: "seeded TUI handoff" },
        { role: "assistant", content: "seeded response" },
      ],
    });
    const summary = runtime.listSessions().find((item) => item.id === session.id);
    expect(summary?.messageCount).toBe(2);
    expect(summary?.preview).toBe("seeded response");
    expect(runtime.getSession(session.id)?.messages).toHaveLength(2);
    expect(runtime.listAudit().some((item) => item.type === "session.created" && item.subjectId === session.id)).toBe(true);

    expect(runtime.deleteSession(session.id)).toEqual({ ok: true, deleted: session.id });

    expect(runtime.listSessions().some((item) => item.id === session.id)).toBe(false);
    expect(runtime.listAudit().some((item) => item.type === "session.deleted" && item.subjectId === session.id)).toBe(true);

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

  it("reactivates a closed session only when new work resumes it", async () => {
    const powerhouse = makePowerhouse();
    const session = powerhouse.createSession();
    powerhouse.closeSession(session.id);

    expect(powerhouse.listSessions().find((item) => item.id === session.id)?.status).toBe("complete");
    const result = await powerhouse.executeStimulus({
      sessionId: session.id,
      stimulus: "resume closed context",
    });

    expect(result.sessionId).toBe(session.id);
    expect(powerhouse.listSessions().find((item) => item.id === session.id)?.status).toBe("active");
    expect(powerhouse.audit.list().some((entry) => entry.type === "session.reopened")).toBe(true);
    powerhouse.stop();
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

  it("recovers an interrupted Symphony plan and continues dependent steps", async () => {
    const dir = tempDir("agentix-plan-recovery-");
    const sessions = new SessionCoordinator(join(dir, "sessions"));
    const taskStore = new TaskStore(join(dir, "tasks.json"));
    const planStore = new PlanStore(join(dir, "plans.json"));
    const session = sessions.create({ source: "plan-recovery-test" });
    const plan: SymphonyPlan = {
      id: "plan-recovery",
      stimulus: "recover the entire plan",
      planner: "static",
      createdAt: Date.now(),
      steps: [
        {
          id: "first",
          kind: "user-message",
          priority: "user",
          payload: { stimulus: "first" },
          dependsOn: [],
          requiresApproval: false,
          maxAttempts: 1,
        },
        {
          id: "second",
          kind: "user-message",
          priority: "user",
          payload: { stimulus: "second" },
          dependsOn: ["first"],
          requiresApproval: false,
          maxAttempts: 1,
        },
        {
          id: "third",
          kind: "user-message",
          priority: "user",
          payload: { stimulus: "third" },
          dependsOn: ["second"],
          requiresApproval: false,
          maxAttempts: 1,
        },
      ],
    };
    const firstTask: Task = {
      id: "task-recovery-first",
      sessionId: session.id,
      planId: plan.id,
      stepId: "first",
      dependsOn: [],
      kind: "user-message",
      priority: "user",
      status: "complete",
      payload: { stimulus: "first" },
      result: "first-persisted-output",
      createdAt: Date.now() - 100,
      startedAt: Date.now() - 90,
      finishedAt: Date.now() - 80,
      attempts: 1,
      maxAttempts: 1,
      requiresApproval: false,
    };
    const interruptedTask: Task = {
      id: "task-recovery-second",
      sessionId: session.id,
      planId: plan.id,
      stepId: "second",
      dependsOn: ["first"],
      kind: "user-message",
      priority: "user",
      status: "running",
      payload: { stimulus: "second" },
      createdAt: Date.now() - 50,
      startedAt: Date.now() - 40,
      attempts: 1,
      maxAttempts: 1,
      requiresApproval: false,
    };
    taskStore.upsert(firstTask);
    taskStore.upsert(interruptedTask);
    sessions.addPendingTask(session.id, interruptedTask.id);
    planStore.upsert({
      plan,
      sessionId: session.id,
      taskIds: [firstTask.id, interruptedTask.id],
      status: "running",
    });
    const agent = new RecoveryAgent();
    const registry = new PIAgentRegistry();
    registry.register(agent);
    const powerhouse = new Powerhouse({
      sessions,
      queue: new TaskQueue(),
      approvals: new ApprovalWorkflow({ timeoutMs: 10_000 }),
      agents: registry,
      memory: new MemoryStore(join(dir, "memory.jsonl")),
      healing: new HealingEngine(join(dir, "healing.json")),
      planStore,
      taskStore,
      audit: new AuditLog(join(dir, "audit.jsonl")),
    });

    powerhouse.start();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (planStore.get(plan.id)?.status === "complete") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const execution = planStore.get(plan.id);
    const tasks = taskStore.list(session.id).filter((task) => task.planId === plan.id);
    expect(execution?.status).toBe("complete");
    expect(agent.calls.map((call) => call.stepId)).toEqual(["second", "third"]);
    expect(agent.calls[1]?.context).toContain("second-recovered-output");
    expect(tasks.find((task) => task.id === firstTask.id)?.status).toBe("complete");
    expect(tasks.find((task) => task.id === interruptedTask.id)?.status).toBe("complete");
    expect(tasks.find((task) => task.stepId === "third")?.status).toBe("complete");
    expect(execution?.taskIds).toHaveLength(3);
    expect(powerhouse.audit.list().some((entry) => entry.type === "plan.recovered")).toBe(true);
    powerhouse.stop();
  });

  it("retry-failed resumes the failed Symphony step and all dependents", async () => {
    const powerhouse = makePowerhouse(new RetryPlanAgent());
    const runtime = new LocalAgentixRuntime({ powerhouse, startScheduler: false });
    const plan = {
      steps: [
        {
          id: "flaky",
          kind: "user-message",
          payload: { stimulus: "flaky" },
          maxAttempts: 1,
        },
        {
          id: "dependent",
          kind: "user-message",
          dependsOn: ["flaky"],
          payload: { stimulus: "dependent" },
          maxAttempts: 1,
        },
      ],
    };

    const initial = await runtime.execute({ stimulus: "plan: " + JSON.stringify(plan) });
    const planId = powerhouse.planStore.list()[0]?.plan.id;
    expect(initial.status).toBe("failed");
    expect(planId).toBeDefined();

    const retried = await runtime.controlPlan(planId!, "retry-failed");
    const execution = powerhouse.planStore.get(planId!);
    const tasks = powerhouse.listTasks().filter((task) => task.planId === planId);

    expect(retried).toMatchObject({ ok: true, action: "retry-failed", count: 2 });
    expect(execution?.status).toBe("complete");
    expect(tasks.filter((task) => task.stepId === "flaky").map((task) => task.status)).toEqual([
      "failed",
      "complete",
    ]);
    expect(tasks.find((task) => task.stepId === "dependent")?.status).toBe("complete");
    expect(String(tasks.find((task) => task.stepId === "dependent")?.payload.context)).toContain(
      "flaky-success",
    );
    expect(execution?.taskIds).toHaveLength(3);
    runtime.shutdown();
  });

  it("owns session undo, branching, and model-backed compaction in Powerhouse", async () => {
    const powerhouse = makePowerhouse();
    const runtime = new LocalAgentixRuntime({ powerhouse, startScheduler: false });
    const messages = Array.from({ length: 4 }, (_, index) => [
      { role: "user" as const, content: `request ${index + 1}` },
      { role: "assistant" as const, content: `response ${index + 1}` },
    ]).flat();
    const session = runtime.createSession({
      model: "test-model",
      provider: "kilo",
      baseUrl: "https://api.kilo.ai/api/gateway",
      skills: ["release-audit"],
      metadata: { source: "untrusted", workspace: "test" },
      messages,
    });
    expect(runtime.getSession(session.id)?.session.metadata).toMatchObject({
      source: "agentix-runtime",
      provider: "kilo",
      baseUrl: "https://api.kilo.ai/api/gateway",
      skills: ["release-audit"],
      workspace: "test",
    });

    const branched = runtime.branchSession(session.id, "Backend-owned branch");
    const branchId = String(branched.id);
    expect(branched).toMatchObject({
      ok: true,
      parentSessionId: session.id,
      title: "Backend-owned branch",
    });
    expect(runtime.getSession(branchId)?.messages).toHaveLength(8);

    const editBranch = runtime.branchSession(session.id, "Editable branch");
    const truncated = runtime.truncateSessionBeforeUserOrdinal(String(editBranch.id), 2);
    expect(truncated).toMatchObject({ ok: true, ordinal: 2, removed: 4 });
    expect(runtime.getSession(String(editBranch.id))?.messages).toHaveLength(4);
    expect(runtime.truncateSessionBeforeUserOrdinal(String(editBranch.id), 8)).toMatchObject({
      ok: false,
      error: "target user message is no longer in session history",
    });

    const undone = runtime.undoSession(branchId);
    expect(undone).toMatchObject({ ok: true, removed: 2 });
    expect(runtime.getSession(branchId)?.messages).toHaveLength(6);

    const compacted = await runtime.compactSession(session.id, "retain implementation decisions");
    expect(compacted).toMatchObject({
      ok: true,
      status: "compressed",
      beforeMessages: 8,
      afterMessages: 3,
      removed: 5,
    });
    const compactedMessages = runtime.getSession(session.id)?.messages ?? [];
    expect(compactedMessages[0]).toMatchObject({ role: "system" });
    expect(compactedMessages[0]?.content).toContain("Earlier session summary");
    expect(powerhouse.audit.list().some((entry) => entry.type === "session.branched")).toBe(true);
    expect(powerhouse.audit.list().some((entry) => entry.type === "session.undone")).toBe(true);
    expect(powerhouse.audit.list().some((entry) => entry.type === "session.history_replaced")).toBe(true);

    runtime.shutdown();
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
    expect(deltas.join("")).toContain(`${result.response}\n[agentix] Step`);

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

    expect(powerhouse.removeAgentProfile("profile-echo")?.id).toBe("profile-echo");
    expect(agentProfiles.list()).toHaveLength(0);
    expect(powerhouse.agents.get("profile-echo")).toBeUndefined();

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

  it("supports Agentix cron schedules and records run metadata", async () => {
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

  it("bounds scheduled script output and terminates timed-out process trees", async () => {
    const powerhouse = makePowerhouse();
    const dir = tempDir("agentix-script-scheduler-bounds-");
    const outputScript = join(dir, "large-output.js");
    const timeoutScript = join(dir, "hang.js");
    writeFileSync(outputScript, "process.stdout.write('x'.repeat(10000))\n", "utf-8");
    writeFileSync(timeoutScript, "setInterval(() => {}, 1000)\n", "utf-8");
    const scheduler = new SchedulerService(
      powerhouse,
      new ScheduledJobStore(join(dir, "jobs.json")),
      new AuditLog(join(dir, "audit.jsonl")),
      [dir],
      { scriptTimeoutMs: 1_000, maxOutputBytes: 1024 },
    );
    const outputJob = scheduler.create({
      name: "bounded output",
      stimulus: "",
      schedule: "every 1m",
      script: outputScript,
      noAgent: true,
    });
    const timeoutJob = scheduler.create({
      name: "bounded timeout",
      stimulus: "",
      schedule: "every 1m",
      script: timeoutScript,
      noAgent: true,
    });

    expect((await scheduler.runNow(outputJob.id)).ok).toBe(true);
    expect(Buffer.byteLength(scheduler.jobs.get(outputJob.id)?.lastOutput ?? "")).toBeLessThanOrEqual(1_100);
    expect(scheduler.jobs.get(outputJob.id)?.lastOutput).toContain("[output truncated]");
    const timeoutResult = await scheduler.runNow(timeoutJob.id);
    expect(timeoutResult.ok).toBe(false);
    expect(timeoutResult.error).toBe("scheduled script timed out after 1000ms");

    scheduler.stop();
    powerhouse.stop();
  });

  it("clears stale scheduler running locks after process restart", () => {
    const powerhouse = makePowerhouse();
    const dir = tempDir("agentix-scheduler-stale-lock-");
    const jobs = new ScheduledJobStore(join(dir, "jobs.json"));
    const audit = new AuditLog(join(dir, "audit.jsonl"));
    const job = jobs.create({ name: "stale", stimulus: "resume", intervalMs: 60_000 });
    jobs.update(job.id, { running: true });

    const scheduler = new SchedulerService(powerhouse, jobs, audit, [dir]);

    expect(scheduler.jobs.get(job.id)?.running).toBe(false);
    expect(audit.list().some((entry) => entry.type === "scheduler.job_recovered")).toBe(true);
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
        metadata: { source: "untrusted", chatId: "channel-1" },
      });
      expect(message.ok).toBe(true);
      expect(message.response).toContain("Powerhouse accepted the task");
      expect(message.delivery).toMatchObject({ attempted: true, ok: true });
      expect(delivered?.gatewayId).toBe("webhook");
      expect(String(delivered?.response)).toContain("Powerhouse accepted the task");

      const gatewaySessionId = String(message.sessionId);
      const sessionsAfterFirstMessage = runtime.listSessions();
      const gatewaySession = sessionsAfterFirstMessage.find((session) => session.id === gatewaySessionId);
      expect(gatewaySession?.metadata).toMatchObject({
        source: "gateway",
        gatewayId: "webhook",
        gatewayPlatform: "webhook",
        chatId: "channel-1",
      });

      const followup = await runtime.receiveGatewayMessage({
        gatewayId: "webhook",
        stimulus: "gateway followup",
        sessionId: gatewaySessionId,
        deliver: false,
      });
      expect(followup.sessionId).toBe(gatewaySessionId);
      expect(followup.delivery).toMatchObject({ attempted: false, error: "delivery disabled" });
      expect(runtime.listSessions()).toHaveLength(sessionsAfterFirstMessage.length);

      const precreated = runtime.createSession({
        metadata: { source: "agentix-runtime", transport: "hermes-derived-gateway" },
      });
      const sessionCountBeforePrecreatedMessage = runtime.listSessions().length;
      const precreatedMessage = await runtime.receiveGatewayMessage({
        gatewayId: "webhook",
        stimulus: "precreated gateway session",
        sessionId: precreated.id,
        metadata: { source: "untrusted", chatId: "channel-2" },
        deliver: false,
      });
      expect(precreatedMessage.sessionId).toBe(precreated.id);
      expect(runtime.listSessions()).toHaveLength(sessionCountBeforePrecreatedMessage);
      expect(runtime.getSession(precreated.id)?.session.metadata).toMatchObject({
        source: "gateway",
        gatewayId: "webhook",
        chatId: "channel-2",
      });

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

  it("creates a support bundle with redacted runtime snapshots", async () => {
    const apiKey = "agentix-test-api-key-never-export";
    const sessionToken = "agentix-test-session-token-never-export";
    const payloadSecret = "payload-bearer-secret-never-export";
    process.env.AGENTIX_LLM_API_KEY = apiKey;
    process.env.AGENTIX_SESSION_TOKEN = sessionToken;
    resetConfigCache();
    const powerhouse = makePowerhouse();
    const runtime = new LocalAgentixRuntime({ powerhouse });
    const runtimeLogs = new RuntimeLogStore();

    runtimeLogs.record({
      timestamp: new Date().toISOString(),
      level: "error",
      source: "system",
      message: `provider failure for ${apiKey} using ${sessionToken}`,
    });
    const execution = await runtime.execute({ stimulus: `support bundle smoke ${apiKey} ${sessionToken}` });
    const task = powerhouse.taskStore.get(execution.taskIds[0]!);
    expect(task).toBeDefined();
    task!.payload.authorization = `Bearer ${payloadSecret}`;
    task!.payload.callback = `https://user:${payloadSecret}@example.test/hook`;
    powerhouse.taskStore.upsert(task!);
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
    expect(manifest.packageName).toBe(pkg.name);
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.installRoot).toBeTruthy();
    expect(manifest.counts.tasks).toBeGreaterThanOrEqual(1);
    expect(manifest.counts.plans).toBeGreaterThanOrEqual(1);
    expect(manifest.counts.sessions).toBeGreaterThanOrEqual(1);

    const config = JSON.parse(readFileSync(join(bundle.bundleDir, "config.json"), "utf-8"));
    expect(config.llmApiKey).toBe("[redacted]");
    expect(config.sessionToken).toBe("[redacted]");

    const readBundle = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? readBundle(path) : [readFileSync(path, "utf-8")];
      });
    const contents = readBundle(bundle.bundleDir).join("\n");
    expect(contents).not.toContain(apiKey);
    expect(contents).not.toContain(sessionToken);
    expect(contents).not.toContain(payloadSecret);
    expect(contents).toContain("[redacted]");

    runtime.shutdown();
  });
});
