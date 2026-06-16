import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeAgent } from "../../src/pi/CodeAgent.js";
import { SandboxAgent } from "../../src/pi/SandboxAgent.js";
import { AuditLog } from "../../src/audit/AuditLog.js";
import { HealingEngine } from "../../src/healing/HealingEngine.js";
import { MemoryStore } from "../../src/memory/MemoryStore.js";
import { ApprovalWorkflow } from "../../src/powerhouse/ApprovalWorkflow.js";
import { Powerhouse } from "../../src/powerhouse/Powerhouse.js";
import { SessionCoordinator } from "../../src/powerhouse/SessionCoordinator.js";
import { TaskQueue } from "../../src/powerhouse/TaskQueue.js";
import { TaskStore } from "../../src/powerhouse/TaskStore.js";
import { PlanStore } from "../../src/symphony/PlanStore.js";
import type { Task } from "../../src/powerhouse/types.js";

const tempDirs: string[] = [];

function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  tempDirs.push(dir);
  return dir;
}

function makeTask(kind: Task["kind"], payload: Record<string, unknown>): Task {
  return {
    id: `task-${Math.random().toString(16).slice(2)}`,
    sessionId: "session-security",
    kind,
    priority: "user",
    status: "running",
    payload,
    createdAt: Date.now(),
    startedAt: Date.now(),
    attempts: 0,
    maxAttempts: 1,
    requiresApproval: false,
  };
}

function makePowerhouse(): Powerhouse {
  const dir = tempDir("agentix-security-powerhouse-");
  return new Powerhouse({
    sessions: new SessionCoordinator(join(dir, "sessions")),
    queue: new TaskQueue(),
    approvals: new ApprovalWorkflow({ timeoutMs: 10_000 }),
    memory: new MemoryStore(join(dir, "memory.jsonl")),
    healing: new HealingEngine(join(dir, "healing.json")),
    planStore: new PlanStore(join(dir, "plans.json")),
    taskStore: new TaskStore(join(dir, "tasks.json")),
    audit: new AuditLog(join(dir, "audit.jsonl")),
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("Pi agent safety guards", () => {
  it("prevents CodeAgent edits outside the project root", async () => {
    const projectRoot = tempDir("agentix-code-root-");
    const outsideRoot = tempDir("agentix-code-outside-");
    const outsideFile = join(outsideRoot, "escape.txt");
    const agent = new CodeAgent({ projectRoot });

    const result = await agent.execute(makeTask("code-edit", {
      file: outsideFile,
      newContent: "outside write",
    }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside project root");
    expect(existsSync(outsideFile)).toBe(false);
  });

  it("allows CodeAgent edits inside the project root", async () => {
    const projectRoot = tempDir("agentix-code-root-");
    const target = join(projectRoot, "inside.txt");
    writeFileSync(target, "before", "utf-8");
    const agent = new CodeAgent({ projectRoot });

    const result = await agent.execute(makeTask("code-edit", {
      file: "inside.txt",
      find: "before",
      replace: "after",
    }));

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ file: target });
  });

  it("prevents SandboxAgent filenames from escaping the sandbox", async () => {
    const rootDir = tempDir("agentix-sandbox-root-");
    const agent = new SandboxAgent({ rootDir });

    const result = await agent.execute(makeTask("sandbox-run", {
      code: "console.log('escape')",
      filename: "../escape.js",
      command: ["node", "../escape.js"],
    }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("escapes sandbox");
    expect(existsSync(join(rootDir, "escape.js"))).toBe(false);
  });

  it("keeps SandboxAgent.list compatible with ESM builds", () => {
    const rootDir = tempDir("agentix-sandbox-root-");
    const agent = new SandboxAgent({ rootDir });

    expect(agent.list()).toEqual([]);
  });

  it("rejects sandbox commands outside the explicit allowlist", async () => {
    const rootDir = tempDir("agentix-sandbox-root-");
    const agent = new SandboxAgent({ rootDir });

    const result = await agent.execute(makeTask("sandbox-run", {
      code: "echo nope",
      filename: "snippet.sh",
      command: ["bash", "snippet.sh"],
    }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not allowed");
  });
});

describe("approval defaults", () => {
  it("approval-gates sandbox shorthand", async () => {
    const powerhouse = makePowerhouse();

    const result = await powerhouse.executeStimulus({
      stimulus: "sandbox: console.log('approval first')",
    });

    expect(result.status).toBe("awaiting-approval");
    expect(powerhouse.listApprovals()[0]?.kind).toBe("sandbox-run");

    powerhouse.stop();
  });

  it("approval-gates explicit code-edit plans by default", async () => {
    const powerhouse = makePowerhouse();
    const plan = {
      steps: [
        {
          id: "edit",
          kind: "code-edit",
          payload: {
            file: "package.json",
            find: "agentix",
            replace: "agentix",
          },
        },
      ],
    };

    const result = await powerhouse.executeStimulus({
      stimulus: `plan: ${JSON.stringify(plan)}`,
    });

    expect(result.status).toBe("awaiting-approval");
    expect(powerhouse.listApprovals()[0]?.kind).toBe("code-edit");

    powerhouse.stop();
  });
});
