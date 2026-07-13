import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeAgent } from "../../src/pi/CodeAgent.js";
import { BashAgent } from "../../src/pi/BashAgent.js";
import { buildDockerSandboxArgs, SandboxAgent } from "../../src/pi/SandboxAgent.js";
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
  it("reports missing executables without hanging", async () => {
    const agent = new BashAgent({ cwd: tempDir("agentix-bash-missing-") });

    const result = await agent.execute(makeTask("bash", {
      command: `agentix-command-that-does-not-exist-${Date.now()}`,
      args: [],
    }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("spawn error");
  });

  it("terminates a hanging process at the configured timeout", async () => {
    const agent = new BashAgent({
      cwd: tempDir("agentix-bash-timeout-"),
      timeoutMs: 50,
    });

    const result = await agent.execute(makeTask("bash", {
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("timeout after 50ms");
  });

  it("cancels a running process through AbortSignal", async () => {
    const agent = new BashAgent({
      cwd: tempDir("agentix-bash-cancel-"),
      timeoutMs: 10_000,
    });
    const controller = new AbortController();
    const execution = agent.execute(makeTask("bash", {
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    }), { signal: controller.signal });
    setTimeout(() => controller.abort(new Error("test cancellation")), 50);

    const result = await execution;

    expect(result.ok).toBe(false);
    expect(result.error).toBe("cancelled");
  });

  it("caps large subprocess output and supports working paths with spaces", async () => {
    const root = tempDir("agentix-bash-output-");
    const cwd = join(root, "folder with spaces");
    mkdirSync(cwd, { recursive: true });
    const agent = new BashAgent({ cwd, maxOutputBytes: 1024 });

    const result = await agent.execute(makeTask("bash", {
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.cwd() + '\\n' + 'x'.repeat(10000))"],
    }));
    const output = result.output as { stdout: string; truncated: boolean };

    expect(result.ok).toBe(true);
    expect(output.stdout).toContain("folder with spaces");
    expect(Buffer.byteLength(output.stdout)).toBeLessThanOrEqual(1024);
    expect(output.truncated).toBe(true);
  });

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

  it("prevents CodeAgent writes through a directory junction", async () => {
    const projectRoot = tempDir("agentix-code-root-");
    const outsideRoot = tempDir("agentix-code-junction-outside-");
    const link = join(projectRoot, "linked-outside");
    symlinkSync(outsideRoot, link, "junction");
    const agent = new CodeAgent({ projectRoot });

    const result = await agent.execute(makeTask("code-edit", {
      file: "linked-outside/escape.txt",
      newContent: "outside write",
    }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("resolves outside project root");
    expect(existsSync(join(outsideRoot, "escape.txt"))).toBe(false);
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
    expect(result.output).toMatchObject({ file: realpathSync(target) });
  });

  it("bounds a hanging CodeAgent TypeScript validation process", async () => {
    const projectRoot = tempDir("agentix-code-validation-timeout-");
    const target = join(projectRoot, "inside.ts");
    const agent = new CodeAgent({
      projectRoot,
      validationTimeoutMs: 100,
      validationCommand: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
    });

    const result = await agent.execute(makeTask("code-edit", {
      file: "inside.ts",
      newContent: "export const value = 1;",
      validateTypeScript: true,
    }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("tsc validation timed out after 100ms");
    expect(existsSync(target)).toBe(true);
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

  it("prevents sandbox session ids and junctions from escaping the root", async () => {
    const rootDir = tempDir("agentix-sandbox-root-");
    const outsideRoot = tempDir("agentix-sandbox-outside-");
    const agent = new SandboxAgent({ rootDir, isolationMode: "local" });
    const traversalTask = makeTask("sandbox-run", {
      code: "console.log('escape')",
      filename: "snippet.js",
      command: ["node", "snippet.js"],
    });
    traversalTask.sessionId = "../../outside-session";

    const traversal = await agent.execute(traversalTask);
    expect(traversal.ok).toBe(false);
    expect(traversal.error).toContain("session id escapes sandbox root");

    const sessionDir = join(rootDir, "session-security");
    mkdirSync(sessionDir, { recursive: true });
    symlinkSync(outsideRoot, join(sessionDir, "linked-outside"), "junction");
    const junction = await agent.execute(makeTask("sandbox-run", {
      code: "console.log('escape')",
      filename: "linked-outside/snippet.js",
      command: ["node", "linked-outside/snippet.js"],
    }));

    expect(junction.ok).toBe(false);
    expect(junction.error).toContain("resolves outside sandbox");
    expect(existsSync(join(outsideRoot, "snippet.js"))).toBe(false);
  });

  it("rejects node commands that bypass the generated sandbox file", async () => {
    const rootDir = tempDir("agentix-sandbox-root-");
    const agent = new SandboxAgent({ rootDir, isolationMode: "local" });

    const result = await agent.execute(makeTask("sandbox-run", {
      code: "console.log('safe file')",
      filename: "snippet.js",
      command: ["node", "-e", "console.log('bypass')"],
    }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("must execute the generated sandbox file");
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

  it("builds Docker sandbox args with network disabled and resource limits", () => {
    const args = buildDockerSandboxArgs("/tmp/agentix-sandbox", "node:22-alpine", ["node", "snippet.js"]);

    expect(args).toContain("--network");
    expect(args).toContain("none");
    expect(args).toContain("--memory");
    expect(args).toContain("256m");
    expect(args).toContain("--pids-limit");
    expect(args).toContain("128");
    expect(args.slice(-3)).toEqual(["node:22-alpine", "node", "snippet.js"]);
  });

  it("marks local sandbox isolation when Docker is disabled", async () => {
    const rootDir = tempDir("agentix-sandbox-root-");
    const agent = new SandboxAgent({ rootDir, isolationMode: "local" });

    const result = await agent.execute(makeTask("sandbox-run", {
      code: "console.log('local isolation')",
      filename: "snippet.js",
      command: ["node", "snippet.js"],
    }));

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ isolation: "local" });
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
