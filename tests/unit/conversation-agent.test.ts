import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
const envBackup = {
  AGENTIX_DATA_DIR: process.env.AGENTIX_DATA_DIR,
  AGENTIX_PROVIDER: process.env.AGENTIX_PROVIDER,
  AGENTIX_MODEL: process.env.AGENTIX_MODEL,
  AGENTIX_BASE_URL: process.env.AGENTIX_BASE_URL,
  AGENTIX_LLM_API_KEY: process.env.AGENTIX_LLM_API_KEY,
};

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentix-conversation-"));
  dirs.push(dir);
  return dir;
}

function restoreEnv(key: keyof typeof envBackup): void {
  const value = envBackup[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("ConversationAgent", () => {
  afterEach(() => {
    for (const key of Object.keys(envBackup) as Array<keyof typeof envBackup>) restoreEnv(key);
    vi.unstubAllGlobals();
    vi.resetModules();
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it("keeps the original request while exposing the planner subtask to the Pi agent", async () => {
    process.env.AGENTIX_DATA_DIR = tempDir();
    process.env.AGENTIX_PROVIDER = "openai";
    process.env.AGENTIX_MODEL = "conversation-model";
    process.env.AGENTIX_BASE_URL = "https://example.invalid/v1";
    process.env.AGENTIX_LLM_API_KEY = "conversation-key";

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      expect(body.messages[1]?.content).toContain("User request:\nExplain the failed test run.");
      expect(body.messages[1]?.content).toContain("Current planned subtask:\nSummarize the test output.");
      return new Response(JSON.stringify({
        choices: [{ message: { content: "The test failed because an assertion did not match." } }],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { ConversationAgent } = await import("../../src/pi/ConversationAgent.js");
    const result = await new ConversationAgent().execute({
      id: "task-conversation",
      sessionId: "session-conversation",
      kind: "user-message",
      priority: "user",
      status: "queued",
      payload: {
        stimulus: "Explain the failed test run.",
        userRequest: "Explain the failed test run.",
        plannedInstruction: "Summarize the test output.",
      },
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: 1,
      requiresApproval: false,
      dependsOn: [],
    });

    expect(result).toEqual({ ok: true, output: "The test failed because an assertion did not match." });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
