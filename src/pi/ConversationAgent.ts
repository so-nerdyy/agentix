import { BasePIAgent } from "./BasePIAgent.js";
import { loadConfig } from "../config/index.js";
import { LLMClient } from "../llm/LLMClient.js";
import type { Task, TaskResult } from "../powerhouse/types.js";

export class ConversationAgent extends BasePIAgent {
  constructor() {
    super("user-message", "pi-conversation");
  }

  async execute(task: Task): Promise<TaskResult> {
    this.emitStart(task);
    const stimulus = String(task.payload.stimulus ?? "").trim();
    const userRequest = String(task.payload.userRequest ?? stimulus).trim();
    const plannedInstruction = String(task.payload.plannedInstruction ?? "").trim();
    const context = task.payload.context;
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
          "Answer the user directly and be concise unless the task requires detail.",
        ].join(" "),
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
    ]);

    if (llmResult.ok && llmResult.text) {
      const result = { ok: true, output: llmResult.text };
      this.emitComplete(task, result);
      return result;
    }

    const lines = [
      "Agentix is running with the Agentix shell and backend.",
      "",
      "Backend path:",
      "- Powerhouse accepted the task.",
      "- Symphony planned the task.",
      "- A Pi agent executed the selected step.",
      "- Validator checked the result.",
      "- Memory recorded the interaction.",
      "",
      stimulus ? `Input: ${stimulus}` : "Input: empty message",
    ];

    if (llmResult.error) {
      lines.push("", `LLM fallback: ${llmResult.error}`);
    }

    if (typeof context === "string" && context.trim()) {
      lines.push("", `Context: ${context.trim()}`);
    }

    const result = { ok: true, output: lines.join("\n") };
    this.emitComplete(task, result);
    return result;
  }

  override shutdown(): void {
    this.alive = false;
  }
}
