import { BasePIAgent } from "./BasePIAgent.js";
import { loadConfig } from "../config/index.js";
import { LLMClient } from "../llm/LLMClient.js";
import type { AgentExecutionContext } from "./BasePIAgent.js";
import type { Task, TaskResult } from "../powerhouse/types.js";

export class ConversationAgent extends BasePIAgent {
  constructor() {
    super("user-message", "pi-conversation");
  }

  async execute(task: Task, executionContext: AgentExecutionContext = {}): Promise<TaskResult> {
    this.emitStart(task);
    const stimulus = String(task.payload.stimulus ?? "").trim();
    const userRequest = String(task.payload.userRequest ?? stimulus).trim();
    const plannedInstruction = String(task.payload.plannedInstruction ?? "").trim();
    const context = task.payload.context;
    const skillInstructions = String(task.payload.skillInstructions ?? "").trim();
    const execution = typeof task.payload.execution === "object" && task.payload.execution !== null
      ? task.payload.execution as Record<string, unknown>
      : {};
    const baseConfig = loadConfig();
    const config = {
      ...baseConfig,
      model: typeof execution.model === "string" && execution.model.trim()
        ? execution.model.trim()
        : baseConfig.model,
      provider: typeof execution.provider === "string" && execution.provider.trim()
        ? execution.provider.trim()
        : baseConfig.provider,
      baseUrl: typeof execution.baseUrl === "string" && execution.baseUrl.trim()
        ? execution.baseUrl.trim()
        : baseConfig.baseUrl,
    };

    const llmResult = await new LLMClient(config).complete([
      {
        role: "system",
        content: [
          "You are Agentix, an autonomous software agent backend.",
          "The Agentix shell owns the terminal UI, setup, commands, and integrations.",
          "The Agentix backend owns Powerhouse orchestration, Symphony planning, Pi agents, memory, approvals, validation, and healing.",
          skillInstructions,
          "Answer the user directly and be concise unless the task requires detail.",
        ].filter(Boolean).join("\n\n"),
      },
      {
        role: "user",
        content: [
          `User request:\n${userRequest || "The user sent an empty message."}`,
          plannedInstruction && plannedInstruction !== userRequest
            ? `\n\nCurrent planned subtask:\n${plannedInstruction}`
            : "",
          typeof context === "string" && context.trim()
            ? `\n\nContext:\n${context.trim()}`
            : "",
        ].join(""),
      },
    ], { signal: executionContext.signal, onDelta: executionContext.onDelta });

    if (llmResult.ok && llmResult.text) {
      const result = { ok: true, output: llmResult.text };
      this.emitComplete(task, result);
      return result;
    }

    const error = llmResult.error ?? "LLM call failed";
    this.emitError(task, error);
    return { ok: false, error, output: error };
  }

  override shutdown(): void {
    this.alive = false;
  }
}
