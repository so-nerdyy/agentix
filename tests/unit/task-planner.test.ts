import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
const envBackup = {
  AGENTIX_DATA_DIR: process.env.AGENTIX_DATA_DIR,
  AGENTIX_PROVIDER: process.env.AGENTIX_PROVIDER,
  AGENTIX_MODEL: process.env.AGENTIX_MODEL,
  AGENTIX_LLM_API_KEY: process.env.AGENTIX_LLM_API_KEY,
};

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentix-planner-"));
  dirs.push(dir);
  return dir;
}

async function importPlanner() {
  vi.resetModules();
  const mod = await import("../../src/symphony/TaskPlanner.js");
  return mod.TaskPlanner;
}

function restoreEnv(key: keyof typeof envBackup): void {
  const value = envBackup[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe("TaskPlanner", () => {
  afterEach(() => {
    restoreEnv("AGENTIX_DATA_DIR");
    restoreEnv("AGENTIX_PROVIDER");
    restoreEnv("AGENTIX_MODEL");
    restoreEnv("AGENTIX_LLM_API_KEY");
    vi.unstubAllGlobals();
    vi.resetModules();
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  it("turns an LLM planner response into safe Symphony steps", async () => {
    process.env.AGENTIX_DATA_DIR = tempDir();
    process.env.AGENTIX_PROVIDER = "openai";
    process.env.AGENTIX_MODEL = "planner-model";
    process.env.AGENTIX_LLM_API_KEY = "planner-key";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reasoning: "Inspect, then explain.",
            steps: [
              {
                id: "inspect",
                kind: "bash",
                priority: "user",
                payload: { commandLine: "npm test" },
                dependsOn: [],
                requiresApproval: false,
                maxAttempts: 2,
              },
              {
                id: "summarize",
                kind: "user-message",
                priority: "user",
                payload: { stimulus: "Summarize the test result." },
                dependsOn: ["inspect"],
                requiresApproval: false,
                maxAttempts: 1,
              },
            ],
          }),
        },
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const TaskPlanner = await importPlanner();
    const plan = await new TaskPlanner().plan("run tests and explain failures");

    expect(plan.planner).toBe("llm");
    expect(plan.reasoning).toBe("Inspect, then explain.");
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]).toMatchObject({
      id: "inspect",
      kind: "bash",
      requiresApproval: true,
      maxAttempts: 2,
      payload: { commandLine: "npm test" },
    });
    expect(plan.steps[1]?.dependsOn).toEqual(["inspect"]);
    expect(plan.steps[1]?.payload).toMatchObject({
      stimulus: "run tests and explain failures",
      userRequest: "run tests and explain failures",
      plannedInstruction: "Summarize the test result.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to static planning when the LLM planner output is invalid", async () => {
    process.env.AGENTIX_DATA_DIR = tempDir();
    process.env.AGENTIX_PROVIDER = "openai";
    process.env.AGENTIX_MODEL = "planner-model";
    process.env.AGENTIX_LLM_API_KEY = "planner-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "not json" } }],
    }), { status: 200 })));

    const TaskPlanner = await importPlanner();
    const plan = await new TaskPlanner().plan("hello planner");

    expect(plan.planner).toBe("static");
    expect(plan.fallbackReason).toBeTruthy();
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      kind: "user-message",
      payload: { stimulus: "hello planner" },
    });
  });

  it("does not invoke the LLM planner for explicit shell commands", async () => {
    process.env.AGENTIX_DATA_DIR = tempDir();
    process.env.AGENTIX_PROVIDER = "openai";
    process.env.AGENTIX_MODEL = "planner-model";
    process.env.AGENTIX_LLM_API_KEY = "planner-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const TaskPlanner = await importPlanner();
    const plan = await new TaskPlanner().plan("run: echo hello");

    expect(plan.planner).toBe("static");
    expect(plan.steps[0]).toMatchObject({
      kind: "bash",
      requiresApproval: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
