import { BasePIAgent } from "./BasePIAgent.js";
import type { Task, TaskResult } from "../powerhouse/types.js";

export class ConversationAgent extends BasePIAgent {
  constructor() {
    super("user-message", "pi-conversation");
  }

  async execute(task: Task): Promise<TaskResult> {
    this.emitStart(task);
    const stimulus = String(task.payload.stimulus ?? "").trim();
    const context = task.payload.context;

    const lines = [
      "Agentix is running with the Hermes frontend and Agentix backend.",
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
