import { afterEach, describe, expect, it, vi } from "vitest";
import { LLMClient } from "../../src/llm/LLMClient.js";
import type { AgentixConfig } from "../../src/config/index.js";

const baseConfig: AgentixConfig = {
  model: "test-model",
  provider: "openai",
  baseUrl: "https://example.test/v1",
  llmApiKey: "test-key",
  lunaModel: null,
  terraModel: null,
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

  it("defaults Kilo Gateway provider to its OpenAI-compatible endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "kilo reply" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new LLMClient({
      ...baseConfig,
      provider: "kilocode",
      baseUrl: null,
    }).complete([{ role: "user", content: "hello" }]);

    expect(result).toEqual({ ok: true, text: "kilo reply" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.kilo.ai/api/gateway/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );
  });

  it("consumes OpenAI-compatible SSE deltas and requests provider streaming", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hello "}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"world"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];

    const result = await new LLMClient(baseConfig).complete(
      [{ role: "user", content: "hello" }],
      { onDelta: (delta) => deltas.push(delta) },
    );

    expect(result).toEqual({ ok: true, text: "hello world" });
    expect(deltas).toEqual(["hello ", "world"]);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.stream).toBe(true);
  });

  it("retries transient provider failures and returns the successful response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "recovered reply" } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new LLMClient(baseConfig).complete(
      [{ role: "user", content: "hello" }],
      { maxAttempts: 2, retryDelayMs: 0 },
    );

    expect(result).toEqual({ ok: true, text: "recovered reply" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry authentication failures or expose response bodies and keys", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: `bad key ${baseConfig.llmApiKey}` },
    }), { status: 401, statusText: "Unauthorized" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new LLMClient(baseConfig).complete(
      [{ role: "user", content: "hello" }],
      { maxAttempts: 3, retryDelayMs: 0 },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("authentication failed");
    expect(result.error).not.toContain(String(baseConfig.llmApiKey));
    expect(result.error).not.toContain("bad key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds a hanging request with a useful timeout", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new LLMClient(baseConfig).complete(
      [{ role: "user", content: "hello" }],
      { timeoutMs: 10, maxAttempts: 1 },
    );

    expect(result).toEqual({
      ok: false,
      error: "LLM request timed out after 10ms (1 attempt)",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the timeout active while a successful response body is still streaming", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            controller.error(init.signal?.reason ?? new Error("aborted"));
          }, { once: true });
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new LLMClient(baseConfig).complete(
      [{ role: "user", content: "hello" }],
      { timeoutMs: 10, maxAttempts: 1 },
    );

    expect(result).toEqual({
      ok: false,
      error: "LLM request timed out after 10ms (1 attempt)",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates external cancellation without retrying", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const completion = new LLMClient(baseConfig).complete(
      [{ role: "user", content: "hello" }],
      { signal: controller.signal, maxAttempts: 3, retryDelayMs: 0 },
    );
    controller.abort(new Error("user cancelled"));

    await expect(completion).resolves.toEqual({ ok: false, error: "LLM request cancelled" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
