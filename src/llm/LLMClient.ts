import type { AgentixConfig } from "../config/index.js";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCompletion {
  ok: boolean;
  text?: string;
  error?: string;
}

export interface LLMRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  onDelta?: (delta: string) => void;
}

type HttpResult =
  | {
      ok: true;
      response: Response;
      cleanup: () => void;
      timedOut: () => boolean;
      timeoutMs: number;
      attempt: number;
    }
  | { ok: false; error: string };

const OPENAI_COMPATIBLE_DEFAULTS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  kilo: "https://api.kilo.ai/api/gateway",
  kilocode: "https://api.kilo.ai/api/gateway",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
  custom: "",
  local: "http://127.0.0.1:11434/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
  "ollama-cloud": "https://ollama.com/v1",
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(5_000, seconds * 1_000));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, Math.min(5_000, date - Date.now()));
}

async function waitForDelay(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  if (ms <= 0) return true;
  return await new Promise<boolean>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class LLMClient {
  constructor(private readonly config: AgentixConfig) {}

  async complete(
    messages: LLMMessage[],
    options: LLMRequestOptions = {},
  ): Promise<LLMCompletion> {
    const provider = this.resolveProvider();
    if (provider === "anthropic") {
      return this.completeAnthropic(messages, options);
    }
    return this.completeOpenAICompatible(provider, messages, options);
  }

  private resolveProvider(): string {
    const explicit = (this.config.provider || "auto").trim().toLowerCase();
    if (explicit && explicit !== "auto") return explicit;
    const model = this.config.model.toLowerCase();
    if (model.includes("claude")) return "anthropic";
    if (model.includes("openrouter/")) return "openrouter";
    if (model.includes("deepseek")) return "deepseek";
    if (model.includes("grok")) return "xai";
    return "openai";
  }

  private async completeOpenAICompatible(
    provider: string,
    messages: LLMMessage[],
    options: LLMRequestOptions,
  ): Promise<LLMCompletion> {
    const baseUrl = this.resolveOpenAIBaseUrl(provider);
    if (!baseUrl) {
      return { ok: false, error: `no base URL configured for provider ${provider}` };
    }
    if (!this.config.llmApiKey && !this.isLocalProvider(provider, baseUrl)) {
      return { ok: false, error: "AGENTIX_LLM_API_KEY is not configured" };
    }

    const request = await this.postJson(
      `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        "Content-Type": "application/json",
        ...(this.config.llmApiKey
          ? { Authorization: `Bearer ${this.config.llmApiKey}` }
          : {}),
      },
      {
        model: this.config.model,
        messages,
        temperature: 0.2,
        ...(options.onDelta ? { stream: true } : {}),
      },
      options,
    );
    if (!request.ok) return request;

    try {
      if (options.onDelta && request.response.headers.get("content-type")?.includes("text/event-stream")) {
        const text = await this.readEventStream(
          request.response,
          (payload) => {
            const choice = (payload.choices as Array<Record<string, unknown>> | undefined)?.[0];
            const delta = choice?.delta as Record<string, unknown> | undefined;
            return typeof delta?.content === "string" ? delta.content : "";
          },
          options.onDelta,
        );
        return text
          ? { ok: true, text: text.trim() }
          : { ok: false, error: "LLM API stream did not include message content" };
      }
      const payload = await request.response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = payload.choices?.[0]?.message?.content?.trim();
      if (text && options.onDelta) options.onDelta(text);
      return text
        ? { ok: true, text }
        : { ok: false, error: "LLM API response did not include message content" };
    } catch {
      return { ok: false, error: this.responseReadError(request, options) };
    } finally {
      request.cleanup();
    }
  }

  private async completeAnthropic(
    messages: LLMMessage[],
    options: LLMRequestOptions,
  ): Promise<LLMCompletion> {
    if (!this.config.llmApiKey) {
      return { ok: false, error: "AGENTIX_LLM_API_KEY is not configured" };
    }
    const system = messages.find((message) => message.role === "system")?.content;
    const turns = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      }));
    const anthropicBaseUrl = (this.config.baseUrl || "https://api.anthropic.com")
      .replace(/\/+$/, "")
      .replace(/\/v1$/, "");
    const request = await this.postJson(
      `${anthropicBaseUrl}/v1/messages`,
      {
        "Content-Type": "application/json",
        "x-api-key": this.config.llmApiKey,
        "anthropic-version": "2023-06-01",
      },
      {
        model: this.config.model,
        max_tokens: 4096,
        system,
        messages: turns,
        ...(options.onDelta ? { stream: true } : {}),
      },
      options,
    );
    if (!request.ok) return request;

    try {
      if (options.onDelta && request.response.headers.get("content-type")?.includes("text/event-stream")) {
        const text = await this.readEventStream(
          request.response,
          (payload) => {
            const delta = payload.delta as Record<string, unknown> | undefined;
            return payload.type === "content_block_delta" && typeof delta?.text === "string"
              ? delta.text
              : "";
          },
          options.onDelta,
        );
        return text
          ? { ok: true, text: text.trim() }
          : { ok: false, error: "LLM API stream did not include text content" };
      }
      const payload = await request.response.json() as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = payload.content
        ?.filter((part) => part.type === "text" && part.text)
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text && options.onDelta) options.onDelta(text);
      return text
        ? { ok: true, text }
        : { ok: false, error: "LLM API response did not include text content" };
    } catch {
      return { ok: false, error: this.responseReadError(request, options) };
    } finally {
      request.cleanup();
    }
  }

  private async postJson(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    options: LLMRequestOptions,
  ): Promise<HttpResult> {
    const timeoutMs = boundedInteger(
      options.timeoutMs ?? process.env.AGENTIX_LLM_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      10,
      10 * 60_000,
    );
    const maxAttempts = boundedInteger(
      options.maxAttempts ?? process.env.AGENTIX_LLM_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS,
      1,
      5,
    );
    const retryDelay = boundedInteger(
      options.retryDelayMs ?? process.env.AGENTIX_LLM_RETRY_DELAY_MS,
      DEFAULT_RETRY_DELAY_MS,
      0,
      5_000,
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (options.signal?.aborted) {
        return { ok: false, error: "LLM request cancelled" };
      }

      const controller = new AbortController();
      let timedOut = false;
      const onExternalAbort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", onExternalAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error(`LLM request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      let responseHandedOff = false;
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onExternalAbort);
      };

      let nextDelay = retryDelay * 2 ** (attempt - 1);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (response.ok) {
          responseHandedOff = true;
          return {
            ok: true,
            response,
            cleanup,
            timedOut: () => timedOut,
            timeoutMs,
            attempt,
          };
        }

        const retryable = isRetryableStatus(response.status);
        nextDelay = retryAfterMs(response) ?? nextDelay;
        await response.body?.cancel().catch(() => undefined);
        if (!retryable || attempt === maxAttempts) {
          return {
            ok: false,
            error: this.httpError(response.status, response.statusText, attempt),
          };
        }
      } catch (error) {
        if (options.signal?.aborted) {
          return { ok: false, error: "LLM request cancelled" };
        }
        if (attempt === maxAttempts) {
          return {
            ok: false,
            error: timedOut
              ? `LLM request timed out after ${timeoutMs}ms (${attempt} attempt${attempt === 1 ? "" : "s"})`
              : `LLM request failed after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${this.safeError(error)}`,
          };
        }
      } finally {
        if (!responseHandedOff) cleanup();
      }

      if (!await waitForDelay(nextDelay, options.signal)) {
        return { ok: false, error: "LLM request cancelled" };
      }
    }

    return { ok: false, error: "LLM request failed" };
  }

  private httpError(status: number, statusText: string, attempts: number): string {
    if (status === 401 || status === 403) {
      return `LLM API authentication failed (${status}). Check the configured provider API key.`;
    }
    if (status === 404) {
      return "LLM API returned 404. Check AGENTIX_BASE_URL and AGENTIX_MODEL.";
    }
    if (status === 429) {
      return `LLM API rate limit persisted after ${attempts} attempt${attempts === 1 ? "" : "s"}.`;
    }
    const label = statusText.trim() || "request failed";
    return `LLM API returned ${status} ${label} after ${attempts} attempt${attempts === 1 ? "" : "s"}.`;
  }

  private responseReadError(
    request: Extract<HttpResult, { ok: true }>,
    options: LLMRequestOptions,
  ): string {
    if (options.signal?.aborted) return "LLM request cancelled";
    if (request.timedOut()) {
      return `LLM request timed out after ${request.timeoutMs}ms (${request.attempt} attempt${request.attempt === 1 ? "" : "s"})`;
    }
    return "LLM API returned malformed or incomplete JSON";
  }

  private async readEventStream(
    response: Response,
    extractDelta: (payload: Record<string, unknown>) => string,
    onDelta: (delta: string) => void,
  ): Promise<string> {
    if (!response.body) throw new Error("LLM API stream did not include a response body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    const consume = (event: string) => {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") return;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data) as Record<string, unknown>;
      } catch {
        throw new Error("LLM API stream returned malformed JSON");
      }
      if (payload.type === "error" || payload.error) {
        throw new Error("LLM API stream returned an error event");
      }
      const delta = extractDelta(payload);
      if (!delta) return;
      text += delta;
      onDelta(delta);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) consume(event);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    return text;
  }

  private safeError(error: unknown): string {
    let message = error instanceof Error ? error.message : String(error);
    if (this.config.llmApiKey) {
      message = message.split(this.config.llmApiKey).join("[redacted]");
    }
    return message.slice(0, 500);
  }

  private resolveOpenAIBaseUrl(provider: string): string {
    return this.config.baseUrl || OPENAI_COMPATIBLE_DEFAULTS[provider] || "";
  }

  private isLocalProvider(provider: string, baseUrl: string): boolean {
    const normalized = provider.toLowerCase();
    return (
      normalized === "local" ||
      normalized === "lmstudio" ||
      baseUrl.includes("127.0.0.1") ||
      baseUrl.includes("localhost")
    );
  }
}
