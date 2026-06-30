import * as readline from "readline";
import { AgentixBackend } from "../agentix_backend.js";
import { PATHS } from "../config/paths.js";

export class HermesShell {
  private backend = new AgentixBackend();
  private rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  private sessionId = "default";
  private history: Array<{ role: string; content: string }> = [];

  async start(): Promise<void> {
    console.log("Agentix - type /help for commands\n");

    this.rl.on("line", async (line) => {
      const input = line.trim();
      if (!input) {
        return;
      }

      if (input.startsWith("/")) {
        await this.handleSlashCommand(input);
      } else {
        await this.handleMessage(input);
      }
    });

    this.rl.on("close", () => {
      process.exit(0);
    });
  }

  private formatSearchResults(results: Record<string, unknown>): string {
    const section = (label: string, items: Array<Record<string, unknown>> | undefined, formatter: (item: Record<string, unknown>) => string) => {
      const list = Array.isArray(items) ? items : [];
      if (list.length === 0) return `${label}: none\n`;
      return `${label} (${list.length})\n${list.slice(0, 5).map((item) => `  - ${formatter(item)}`).join("\n")}\n`;
    };

    return [
      `Search results for "${String(results.query ?? "")}"`,
      section("Tasks", results.tasks as Array<Record<string, unknown>> | undefined, (item) => {
        const summary = String(item.summary ?? item.error ?? "");
        return `${String(item.id ?? "")} [${String(item.status ?? "")}] ${summary.slice(0, 120)}`;
      }),
      section("Sessions", results.sessions as Array<Record<string, unknown>> | undefined, (item) => {
        return `${String(item.id ?? "")} [${String(item.status ?? "")}]`;
      }),
      section("Memory", results.memory as Array<Record<string, unknown>> | undefined, (item) => {
        const content = String(item.content ?? "");
        return `${String(item.role ?? "memory")} ${content.slice(0, 120)}`;
      }),
      section("Logs", results.logs as Array<Record<string, unknown>> | undefined, (item) => {
        return `${String(item.timestamp ?? "")} ${String(item.level ?? "")} ${String(item.message ?? "").slice(0, 120)}`;
      }),
      section("Audit", results.audit as Array<Record<string, unknown>> | undefined, (item) => {
        return `${String(item.type ?? "")} ${String(item.id ?? "")}`;
      }),
      section("Jobs", results.jobs as Array<Record<string, unknown>> | undefined, (item) => {
        return `${String(item.name ?? "")} [${item.enabled ? "enabled" : "disabled"}]`;
      }),
      section("Healing", results.healing as Array<Record<string, unknown>> | undefined, (item) => {
        return `${String(item.fingerprint ?? "")} (${String(item.count ?? 0)}x)`;
      }),
    ].join("\n");
  }

  private formatUsage(usage: Record<string, unknown>): string {
    const counts = usage.counts as Record<string, unknown> | undefined;
    return [
      String(usage.title ?? "Agentix backend usage"),
      `Sessions: ${String(counts?.sessions ?? 0)}  Tasks: ${String(counts?.tasks ?? 0)}  Plans: ${String(counts?.plans ?? 0)}`,
      `Memory: ${String(counts?.memory ?? 0)}  Jobs: ${String(counts?.jobs ?? 0)}  Gateways: ${String(counts?.gateways ?? 0)}`,
      String(usage.note ?? ""),
    ].filter(Boolean).join("\n");
  }

  private formatSessions(sessions: Array<{ id: string; createdAt: string; status?: string }>): string {
    if (sessions.length === 0) return "No sessions.";
    return [
      `Recent sessions (${sessions.length})`,
      ...sessions.map((session) => `  - ${session.id} [${session.status ?? "unknown"}] created=${session.createdAt}`),
    ].join("\n");
  }

  private formatJobs(jobs: Array<Record<string, unknown>>): string {
    if (jobs.length === 0) return "No scheduled jobs.";
    return [
      `Scheduled jobs (${jobs.length})`,
      ...jobs.map((job) => `  - ${String(job.id ?? "")} ${String(job.name ?? "")} [${job.enabled ? "enabled" : "disabled"}] next=${String(job.nextRunAt ?? "n/a")}`),
    ].join("\n");
  }

  private formatTools(tools: Array<{ name: string; description: string }>): string {
    if (tools.length === 0) return "No tools registered.";
    return [
      `Agentix tools (${tools.length})`,
      ...tools.map((tool) => `  - ${tool.name}: ${tool.description}`),
    ].join("\n");
  }

  private async handleSlashCommand(input: string): Promise<void> {
    const [commandLine, ...restArgs] = input.slice(1).split(/\n+/);
    const parts = commandLine.split(" ");
    const name = parts[0]?.toLowerCase() ?? "";
    const subArgs = parts.slice(1);

    try {
      switch (name) {
        case "help":
          this.printHelp();
          break;
        case "new":
          this.sessionId = `session-${Date.now()}`;
          this.history = [];
          console.log("-> New session started.\n");
          break;
        case "reset":
          this.history = [];
          console.log("-> Context reset.\n");
          break;
        case "status":
          this.showStatus();
          break;
        case "history":
          this.showHistory();
          break;
        case "doctor":
          console.log(this.formatDoctor(await this.backend.doctor()));
          console.log("\nUse `agentix doctor --full` for full diagnostics.");
          break;
        case "usage":
          console.log(this.formatUsage(await this.backend.usage()));
          break;
        case "setup":
          console.log("Run `agentix setup` in a terminal to configure this workspace.\n");
          break;
        case "model":
          console.log("Run `agentix model` in a terminal to configure provider/model settings.\n");
          break;
        case "options":
          console.log("Run `agentix options` in a terminal to list setup/provider/model options.\n");
          break;
        case "update":
          console.log("Run `agentix update --check` in a terminal to check npm/install updates.");
          break;
        case "cron":
        case "scheduler": {
          const [action] = [...subArgs, ...restArgs];
          if (!action || action === "list") {
            console.log(this.formatJobs(await this.backend.listScheduledJobs()));
            break;
          }
          if (action === "run-due") {
            console.log(JSON.stringify(await this.backend.runDueScheduledJobs(), null, 2));
            break;
          }
          console.log("Usage: /cron [list|run-due]. Use `agentix cron create ...` for job creation.");
          break;
        }
        case "job": {
          const [jobId, action] = [...subArgs, ...restArgs];
          if (!jobId) {
            console.log("Usage: /job <job-id> [inspect|run|enable|disable]\n");
            break;
          }
          if (!action || action === "inspect") {
            console.log(JSON.stringify(await this.backend.getScheduledJob(jobId), null, 2));
            break;
          }
          if (action === "run") {
            console.log(JSON.stringify(await this.backend.runScheduledJob(jobId), null, 2));
            break;
          }
          if (action === "enable" || action === "disable") {
            console.log(
              JSON.stringify(
                await this.backend.setScheduledJobEnabled(jobId, action === "enable"),
                null,
                2,
              ),
            );
            break;
          }
          console.log(`Unknown /job action: ${action}\n`);
          break;
        }
        case "gateway": {
          const [gatewayId, action, ...actionArgs] = [...subArgs, ...restArgs];
          if (!gatewayId) {
            const gateways = await this.backend.listGateways();
            console.log([
              "Configured gateways:",
              ...gateways.map((gateway) =>
                `  - ${String(gateway.id ?? "")} [${String(gateway.status ?? "")}] ${String(gateway.name ?? "")} (${String(gateway.platform ?? "")})`,
              ),
            ].join("\n"));
            break;
          }
          if (!action || action === "inspect") {
            console.log(JSON.stringify(await this.backend.getGateway(gatewayId), null, 2));
            break;
          }
          if (action === "enable" || action === "disable") {
            console.log(JSON.stringify(await this.backend.setGatewayEnabled(gatewayId, action === "enable"), null, 2));
            break;
          }
          if (action === "message" || action === "send") {
            const stimulus = actionArgs.join(" ").trim();
            if (!stimulus) {
              console.log("Usage: /gateway <gateway-id> message <stimulus>\n");
              break;
            }
            console.log(
              JSON.stringify(
                await this.backend.receiveGatewayMessage({
                  gatewayId,
                  stimulus,
                }),
                null,
                2,
              ),
            );
            break;
          }
          console.log(`Unknown /gateway action: ${action}\n`);
          break;
        }
        case "sessions":
          console.log(this.formatSessions(await this.backend.listSessions({ limit: 20 })));
          break;
        case "session": {
          const [sessionId, action, ...actionArgs] = [...subArgs, ...restArgs];
          if (!sessionId) {
            console.log("Usage: /session <session-id> [inspect|open|close]\n");
            break;
          }
          if (!action || action === "inspect" || action === "open") {
            const detail = await this.backend.getSession(sessionId);
            console.log(this.formatSessionDetail(detail));
            break;
          }
          if (action === "close") {
            console.log(JSON.stringify(await this.backend.deleteSession(sessionId), null, 2));
            break;
          }
          console.log(`Unknown /session action: ${action}\n`);
          break;
        }
        case "skills":
          console.log(this.formatTools(await this.backend.listTools()));
          console.log("\nAgentix uses backend tools/Pi agents. Use `agentix mods` for module inventory.");
          break;
        case "approval": {
          const [taskId, action, ...actionArgs] = [...subArgs, ...restArgs];
          if (!taskId) {
            console.log("Usage: /approval <task-id> [inspect|approve|reject]\n");
            break;
          }
          if (!action || action === "inspect") {
            console.log(JSON.stringify(await this.backend.getApproval(taskId), null, 2));
            break;
          }
          if (action === "approve") {
            console.log(JSON.stringify(await this.backend.approve(taskId), null, 2));
            break;
          }
          if (action === "reject") {
            const reason = actionArgs.join(" ").trim() || "rejected from Agentix shell";
            console.log(JSON.stringify(await this.backend.reject(taskId, reason), null, 2));
            break;
          }
          console.log(`Unknown /approval action: ${action}\n`);
          break;
        }
        case "healing": {
          const [entryId, action] = [...subArgs, ...restArgs];
          if (!entryId) {
            console.log("Usage: /healing <fingerprint|procedure-id> [inspect|promote|deprecate]\n");
            break;
          }
          if (!action || action === "inspect") {
            console.log(JSON.stringify(await this.backend.getHealingDetail(entryId), null, 2));
            break;
          }
          if (action === "promote") {
            console.log(JSON.stringify(await this.backend.promoteHealingProcedure(entryId), null, 2));
            break;
          }
          if (action === "deprecate") {
            console.log(JSON.stringify(await this.backend.deprecateHealingProcedure(entryId), null, 2));
            break;
          }
          console.log(`Unknown /healing action: ${action}\n`);
          break;
        }
        case "audit": {
          const [entryId, action] = [...subArgs, ...restArgs];
          if (!entryId) {
            console.log("Usage: /audit <audit-id> [inspect]\n");
            break;
          }
          if (!action || action === "inspect") {
            console.log(JSON.stringify(await this.backend.getAudit(entryId), null, 2));
            break;
          }
          console.log(`Unknown /audit action: ${action}\n`);
          break;
        }
        case "tools":
          console.log(this.formatTools(await this.backend.listTools()));
          break;
        case "tool": {
          const [toolId, action] = [...subArgs, ...restArgs];
          if (!toolId) {
            console.log("Usage: /tool <tool-id> [inspect]\n");
            break;
          }
          if (!action || action === "inspect") {
            console.log(JSON.stringify(await this.backend.getTool(toolId), null, 2));
            break;
          }
          console.log(`Unknown /tool action: ${action}\n`);
          break;
        }
        case "search": {
          const query = [...subArgs, ...restArgs].join(" ").trim();
          if (!query) {
            console.log("Usage: /search <query>\n");
            break;
          }
          console.log(this.formatSearchResults(await this.backend.search(query)));
          break;
        }
        case "plans": {
          console.log(this.formatPlans(await this.backend.listPlans()));
          break;
        }
        case "plan": {
          const [planId, action] = [...subArgs, ...restArgs];
          if (!planId) {
            console.log("Usage: /plan <plan-id> [replay|cancel|retry-failed]\n");
            break;
          }
          if (action === "replay" || action === "cancel" || action === "retry-failed") {
            console.log(JSON.stringify(await this.backend.controlPlan(planId, action), null, 2));
            break;
          }
          console.log(this.formatPlan(await this.backend.getPlan(planId)));
          break;
        }
        case "task": {
          const [taskId, action, ...actionArgs] = [...subArgs, ...restArgs];
          if (!taskId) {
            console.log("Usage: /task <task-id> [inspect|approve|reject|cancel|retry|restart]\n");
            break;
          }
          if (!action || action === "inspect") {
            const detail = await this.backend.getTask(taskId);
            console.log(JSON.stringify(detail, null, 2));
            break;
          }
          if (action === "approve") {
            console.log(JSON.stringify(await this.backend.approve(taskId), null, 2));
            break;
          }
          if (action === "reject") {
            const reason = actionArgs.join(" ").trim() || "rejected from Agentix shell";
            console.log(JSON.stringify(await this.backend.reject(taskId, reason), null, 2));
            break;
          }
          if (action === "cancel" || action === "retry" || action === "restart") {
            console.log(JSON.stringify(await this.backend.controlTask(taskId, action), null, 2));
            break;
          }
          console.log(`Unknown /task action: ${action}\n`);
          break;
        }
        case "memory": {
          const query = [...subArgs, ...restArgs].join(" ").trim();
          if (!query) {
            console.log("Usage: /memory <search-query>\n");
            break;
          }
          console.log(JSON.stringify(await this.backend.memorySearch(query), null, 2));
          break;
        }
        case "logs": {
          const query = [...subArgs, ...restArgs].join(" ").trim();
          const logs = await this.backend.listLogs();
          const filtered = query
            ? logs.filter((entry) => JSON.stringify(entry).toLowerCase().includes(query.toLowerCase()))
            : logs;
          console.log(JSON.stringify(filtered.slice(-50), null, 2));
          break;
        }
        case "log": {
          const [index, action] = [...subArgs, ...restArgs];
          if (index === undefined) {
            console.log("Usage: /log <index> [inspect]\n");
            break;
          }
          if (!action || action === "inspect") {
            console.log(JSON.stringify(await this.backend.getLog(Number(index)), null, 2));
            break;
          }
          console.log(`Unknown /log action: ${action}\n`);
          break;
        }
        case "theme":
          console.log("Theme is controlled by the Agentix shell.\n");
          break;
        case "personality":
          console.log("Personality is controlled by the Agentix shell.\n");
          break;
        case "exit":
        case "quit":
          this.rl.close();
          break;
        case "fortune":
          console.log("Agentix: Powerhouse plans, Symphony schedules, Pi agents execute.");
          break;
        default:
          console.log(`Unknown command: /${name}. Type /help for available commands.\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}\n`);
    }
  }

  private async handleMessage(input: string): Promise<void> {
    this.history.push({ role: "user", content: input });

    try {
      process.stdout.write("-> ");
      let response = "";
      await this.backend.executeStream({
        stimulus: input,
        sessionId: this.sessionId,
        streamCallback: (delta: string) => {
          process.stdout.write(delta);
          response += delta;
        },
      });
      this.history.push({ role: "assistant", content: response });
      console.log();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError: ${message}\n`);
    }
  }

  private printHelp(): void {
    console.log(`Available commands:
  /new                Start a new session
  /reset              Clear conversation context
  /status             Show current session and bridge
  /history            Show conversation history
  /doctor             Run Agentix diagnostics
  /usage              Show usage stats
  /setup              Run first-run setup wizard
  /model              Configure model provider
  /options            Show setup/provider/model options
  /update             Check for updates
  /cron <args>        Manage scheduled tasks
  /job <id> [action]  Inspect or run a scheduled job
  /gateway [id] [action]  Inspect or manage gateway integrations
  /sessions <args>    Manage sessions
  /session <id> [action] Inspect a session
  /approval <id> [action] Inspect or decide an approval
  /healing <id> [action] Inspect or manage healing records
  /audit <id> [action] Inspect an audit entry
  /skills <args>      Manage skills
  /tools <args>       Manage tools
  /tool <id> [action] Inspect a tool
  /search <query>     Search tasks, sessions, memory, logs, jobs, healing
  /plans              List Symphony plan executions
  /plan <id>          Inspect a Symphony plan execution
  /task <id> [action] Inspect or control a task
  /memory <query>     Search memory
  /logs [query]       Search logs
  /log <index> [action] Inspect a log entry
  /theme              Show theme source
  /personality        Show personality source
  /fortune            Random wisdom
  /exit               Exit Agentix
  /help               Show this help
`);
  }

  private showStatus(): void {
    console.log(`Session: ${this.sessionId}`);
    console.log(
      `Bridge: ${process.env.AGENTIX_BRIDGE_URL || process.env.HERMES_BRIDGE_URL || "http://127.0.0.1:3456"}`,
    );
    console.log(`Agentix frontend root: ${PATHS.hermesRoot}`);
    console.log();
  }

  private showHistory(): void {
    if (this.history.length === 0) {
      console.log("(no history)\n");
      return;
    }

    for (const msg of this.history) {
      const label = msg.role === "user" ? "You" : "Assistant";
      const preview =
        msg.content.length > 80 ? `${msg.content.slice(0, 80)}...` : msg.content;
      console.log(`[${label}] ${preview}`);
    }
    console.log();
  }

  private formatSessionDetail(detail: Record<string, unknown>): string {
    const session = (detail.session as Record<string, unknown> | undefined) ?? {};
    const tasks = (detail.tasks as Array<Record<string, unknown>> | undefined) ?? [];
    const memory = (detail.memory as Array<Record<string, unknown>> | undefined) ?? [];
    const audit = (detail.audit as Array<Record<string, unknown>> | undefined) ?? [];
    const logs = (detail.logs as Array<Record<string, unknown>> | undefined) ?? [];

    return [
      `Session ${String(session.id ?? "")} [${String(session.status ?? "")}]`,
      `Created: ${String(session.createdAt ?? "")}`,
      `Updated: ${String(session.updatedAt ?? "")}`,
      `Tasks (${tasks.length})`,
      ...tasks.slice(0, 5).map((task) => `  - ${String(task.id ?? "")} [${String(task.status ?? "")}] ${String(task.kind ?? "")}`),
      `Memory (${memory.length})`,
      ...memory.slice(0, 5).map((entry) => `  - ${String(entry.role ?? "memory")} ${String(entry.content ?? "").slice(0, 120)}`),
      `Audit (${audit.length})`,
      ...audit.slice(0, 5).map((entry) => `  - ${String(entry.type ?? "")} ${String(entry.id ?? "")}`),
      `Logs (${logs.length})`,
      ...logs.slice(0, 5).map((entry) => `  - ${String(entry.level ?? "")} ${String(entry.message ?? "").slice(0, 120)}`),
    ].join("\n");
  }

  private formatDoctor(report: Record<string, unknown>): string {
    const checks = (report.checks as Array<Record<string, unknown>> | undefined) ?? [];
    const counts = (report.counts as Record<string, unknown> | undefined) ?? {};
    const config = (report.config as Record<string, unknown> | undefined) ?? {};
    return [
      `Agentix backend doctor: ${String(report.status ?? "unknown").toUpperCase()}`,
      `Workspace: ${String(report.workspace ?? "")}`,
      `Model: ${String(config.provider ?? "auto")} / ${String(config.model ?? "")}`,
      `LLM key: ${config.llmApiKeyConfigured ? "configured" : "missing"}`,
      `Counts: sessions=${String(counts.sessions ?? 0)} tasks=${String(counts.tasks ?? 0)} plans=${String(counts.plans ?? 0)} approvals=${String(counts.approvals ?? 0)}`,
      "Checks:",
      ...checks.map((check) => {
        const status = String(check.status ?? "unknown").toUpperCase();
        const action = check.action ? ` (action: ${String(check.action)})` : "";
        return `  [${status}] ${String(check.label ?? check.id ?? "")}: ${String(check.detail ?? "")}${action}`;
      }),
    ].join("\n");
  }

  private formatPlans(plans: Array<Record<string, unknown>>): string {
    if (!Array.isArray(plans) || plans.length === 0) {
      return "No Symphony plans recorded.";
    }
    return [
      "Symphony plans:",
      ...plans.slice(0, 20).map((plan) =>
        `  - ${String(plan.id ?? "")} [${String(plan.status ?? "")}] ${String(plan.planner ?? "")} steps=${String(plan.stepCount ?? 0)} tasks=${String(plan.taskCount ?? 0)} ${String(plan.stimulus ?? "").slice(0, 100)}`,
      ),
    ].join("\n");
  }

  private formatPlan(detail: Record<string, unknown>): string {
    const plan = (detail.plan as Record<string, unknown> | undefined) ?? {};
    const steps = (detail.steps as Array<Record<string, unknown>> | undefined) ?? [];
    const tasks = (detail.tasks as Array<Record<string, unknown>> | undefined) ?? [];
    const audit = (detail.audit as Array<Record<string, unknown>> | undefined) ?? [];
    return [
      `Plan ${String(plan.id ?? "")} [${String(plan.status ?? "")}]`,
      `Planner: ${String(plan.planner ?? "")}`,
      `Stimulus: ${String(plan.stimulus ?? "").slice(0, 180)}`,
      plan.reasoning ? `Reasoning: ${String(plan.reasoning)}` : "",
      plan.fallbackReason ? `Fallback: ${String(plan.fallbackReason)}` : "",
      `Steps (${steps.length})`,
      ...steps.map((step) =>
        `  - ${String(step.id ?? "")} [${String(step.status ?? "pending")}] ${String(step.kind ?? "")} depends=${String((step.dependsOn as unknown[] | undefined)?.join(",") ?? "none")} task=${String(step.taskId ?? "-")}`,
      ),
      `Tasks (${tasks.length})`,
      ...tasks.slice(0, 8).map((task) =>
        `  - ${String(task.id ?? "")} [${String(task.status ?? "")}] ${String(task.kind ?? "")}`,
      ),
      `Audit (${audit.length})`,
      ...audit.slice(0, 5).map((entry) => `  - ${String(entry.type ?? "")} ${String(entry.id ?? "")}`),
    ].filter(Boolean).join("\n");
  }
}
