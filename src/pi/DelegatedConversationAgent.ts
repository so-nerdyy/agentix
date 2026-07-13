import { loadConfig } from "../config/index.js";
import { LLMClient } from "../llm/LLMClient.js";
import { BasePIAgent } from "./BasePIAgent.js";
import type { AgentExecutionContext } from "./BasePIAgent.js";
import type { Task, TaskResult } from "../powerhouse/types.js";

export type DelegateRole = "luna" | "terra";

const ROLE_PROMPTS: Record<DelegateRole, string> = {
  luna: [
    "You are Luna, a focused Agentix Pi subagent.",
    "Handle bounded reviews, tests, documentation, configuration checks, and isolated fixes.",
    "Return concise evidence and an implementation-ready result to the Powerhouse agent.",
    "Do not claim that commands or edits were performed unless the supplied context proves it.",
  ].join(" "),
  terra: [
    "You are Terra, Agentix's deep-reasoning Pi subagent.",
    "Handle architecture, complex debugging, concurrency, security, migrations, and multi-system work.",
    "Analyze dependencies and risks, then return a concrete implementation-ready result to the Powerhouse agent.",
    "Do not claim that commands or edits were performed unless the supplied context proves it.",
  ].join(" "),
};

export class DelegatedConversationAgent extends BasePIAgent {
  constructor(readonly role: DelegateRole) {
    super(`${role}-message`, `pi-${role}`);
  }

  async execute(task: Task, executionContext: AgentExecutionContext = {}): Promise<TaskResult> {
    this.emitStart(task);
    const baseConfig = loadConfig();
    const model = this.role === "luna" ? baseConfig.lunaModel : baseConfig.terraModel;
    if (!model) {
      const error = `${this.role} delegation is not configured; set AGENTIX_${this.role.toUpperCase()}_MODEL`;
      this.emitError(task, error);
      return { ok: false, error };
    }

    const execution = typeof task.payload.execution === "object" && task.payload.execution !== null
      ? task.payload.execution as Record<string, unknown>
      : {};
    const config = {
      ...baseConfig,
      model,
      provider: typeof execution.provider === "string" && execution.provider.trim()
        ? execution.provider.trim()
        : baseConfig.provider,
      baseUrl: typeof execution.baseUrl === "string" && execution.baseUrl.trim()
        ? execution.baseUrl.trim()
        : baseConfig.baseUrl,
    };
    const stimulus = String(task.payload.stimulus ?? "").trim();
    const userRequest = String(task.payload.userRequest ?? stimulus).trim();
    const plannedInstruction = String(task.payload.plannedInstruction ?? "").trim();
    const context = typeof task.payload.context === "string" ? task.payload.context.trim() : "";
    const skillInstructions = String(task.payload.skillInstructions ?? "").trim();

    const completion = await new LLMClient(config).complete([
      {
        role: "system",
        content: [
          ROLE_PROMPTS[this.role],
          "You are controlled by Agentix Powerhouse and scheduled through Symphony.",
          "You are a Pi execution agent, not the terminal interface or the top-level orchestrator.",
          skillInstructions,
        ].filter(Boolean).join("\n\n"),
      },
      {
        role: "user",
        content: [
          `User request:\n${userRequest || "The user sent an empty request."}`,
          plannedInstruction && plannedInstruction !== userRequest
            ? `\n\nAssigned subtask:\n${plannedInstruction}`
            : "",
          context ? `\n\nPowerhouse context:\n${context}` : "",
        ].join(""),
      },
    ], { signal: executionContext.signal, onDelta: executionContext.onDelta });

    if (completion.ok && completion.text) {
      const result = { ok: true, output: completion.text };
      this.emitComplete(task, result);
      return result;
    }

    const error = completion.error ?? `${this.role} model call failed`;
    this.emitError(task, error);
    return { ok: false, error, output: error };
  }

  override shutdown(): void {
    this.alive = false;
  }
}
