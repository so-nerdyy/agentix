import { afterEach, describe, expect, it, vi } from "vitest";
import { LLMClient } from "../../src/llm/LLMClient.js";
import type { AgentixConfig } from "../../src/config/index.js";

const baseConfig: AgentixConfig = {
  model: "test-model",
  provider: "openai",
  baseUrl: "https://example.test/v1",
  llmApiKey: "test-key",
  sessionTtlMs: 1,
  approvalTimeoutMs: 1,
  dataDir: "data",
  inboxPort: 3000,
  bridgePort: 3456,
  sessionToken: null,
};

describe("LLMClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls OpenAI-compatible chat completions", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "model reply" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new LLMClient(baseConfig).complete([
      { role: "user", content: "hello" },
    ]);

    expect(result).toEqual({ ok: true, text: "model reply" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );
  });

  it("fails closed when a non-local provider has no API key", async () => {
    const result = await new LLMClient({ ...baseConfig, llmApiKey: null }).complete([
      { role: "user", content: "hello" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("AGENTIX_LLM_API_KEY");
  });

  it("calls Anthropic messages for Claude models", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: "text", text: "anthropic reply" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new LLMClient({
      ...baseConfig,
      provider: "auto",
      model: "claude-sonnet-test",
      baseUrl: null,
    }).complete([
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" },
    ]);

    expect(result).toEqual({ ok: true, text: "anthropic reply" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "test-key",
        }),
      }),
    );
  });
});
