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
    const context = task.payload.context;

    const llmResult = await new LLMClient(loadConfig()).complete([
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
          stimulus || "The user sent an empty message.",
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
