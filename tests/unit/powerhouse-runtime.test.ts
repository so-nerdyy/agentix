import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationAgent } from "../../src/pi/ConversationAgent.js";
import { HealingEngine } from "../../src/healing/HealingEngine.js";
import { MemoryStore } from "../../src/memory/MemoryStore.js";
import { ApprovalWorkflow } from "../../src/powerhouse/ApprovalWorkflow.js";
import { PIAgentRegistry } from "../../src/powerhouse/PIAgentRegistry.js";
import { Powerhouse } from "../../src/powerhouse/Powerhouse.js";
import { SessionCoordinator } from "../../src/powerhouse/SessionCoordinator.js";
import { TaskQueue } from "../../src/powerhouse/TaskQueue.js";
import { LocalAgentixRuntime } from "../../src/runtime/LocalAgentixRuntime.js";

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
    healing: new HealingEngine(),
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
});
