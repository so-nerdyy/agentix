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

export class LLMClient {
  constructor(private readonly config: AgentixConfig) {}

  async complete(messages: LLMMessage[]): Promise<LLMCompletion> {
    const provider = this.resolveProvider();
    if (provider === "anthropic") {
      return this.completeAnthropic(messages);
    }
    return this.completeOpenAICompatible(provider, messages);
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
  ): Promise<LLMCompletion> {
    const baseUrl = this.resolveOpenAIBaseUrl(provider);
    if (!baseUrl) {
      return { ok: false, error: `no base URL configured for provider ${provider}` };
    }
    if (!this.config.llmApiKey && !this.isLocalProvider(provider, baseUrl)) {
      return { ok: false, error: "AGENTIX_LLM_API_KEY is not configured" };
    }

    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.llmApiKey
            ? { Authorization: `Bearer ${this.config.llmApiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.2,
        }),
      });
      if (!res.ok) {
        return { ok: false, error: `LLM API returned ${res.status}: ${await res.text()}` };
      }
      const payload = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = payload.choices?.[0]?.message?.content?.trim();
      return text
        ? { ok: true, text }
        : { ok: false, error: "LLM API response did not include message content" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async completeAnthropic(messages: LLMMessage[]): Promise<LLMCompletion> {
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

    try {
      const anthropicBaseUrl = (this.config.baseUrl || "https://api.anthropic.com")
        .replace(/\/+$/, "")
        .replace(/\/v1$/, "");
      const res = await fetch(
        `${anthropicBaseUrl}/v1/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.config.llmApiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: this.config.model,
            max_tokens: 4096,
            system,
            messages: turns,
          }),
        },
      );
      if (!res.ok) {
        return { ok: false, error: `LLM API returned ${res.status}: ${await res.text()}` };
      }
      const payload = await res.json() as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = payload.content
        ?.filter((part) => part.type === "text" && part.text)
        .map((part) => part.text)
        .join("\n")
        .trim();
      return text
        ? { ok: true, text }
        : { ok: false, error: "LLM API response did not include text content" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
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
