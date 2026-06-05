import * as readline from "readline";
import { spawn } from "child_process";
import { AgentixBackend } from "../agentix_backend.js";
import { hermesCommand } from "./hermes_python_bridge.js";
import { PATHS } from "../config/paths.js";

function hermesEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONPATH: PATHS.hermesRoot,
    AGENTIX_FRONTEND: "hermes",
    AGENTIX_INSTALL_ROOT: PATHS.projectRoot,
    AGENTIX_BRIDGE_URL:
      process.env.AGENTIX_BRIDGE_URL || "http://127.0.0.1:3456",
    HERMES_BRIDGE_URL:
      process.env.HERMES_BRIDGE_URL || "http://127.0.0.1:3456",
  };
}

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
    console.log("Agentix (Hermes frontend) - type /help for commands\n");

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

  private async runHermesInteractive(subcommand: string): Promise<void> {
    const child = spawn("python", ["-m", "hermes_cli.main", subcommand], {
      cwd: PATHS.hermesRoot,
      stdio: "inherit",
      env: hermesEnv(),
    });
    await new Promise<void>((resolve) => child.on("close", resolve));
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
          console.log(await hermesCommand("doctor", []));
          break;
        case "usage":
          console.log(await hermesCommand("usage", []));
          break;
        case "setup":
          console.log("-> Running Hermes setup wizard...\n");
          await this.runHermesInteractive("setup");
          break;
        case "model":
          console.log("-> Running Hermes model configuration...\n");
          await this.runHermesInteractive("model");
          break;
        case "update":
          console.log(await hermesCommand("update", ["--check"], 15_000));
          break;
        case "cron":
          console.log(await hermesCommand("cron", [...subArgs, ...restArgs]));
          break;
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
          console.log(await hermesCommand("sessions", [...subArgs, ...restArgs]));
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
          console.log(await hermesCommand("skills", [...subArgs, ...restArgs]));
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
            const reason = actionArgs.join(" ").trim() || "rejected from Hermes shell";
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
          console.log(await hermesCommand("tools", [...subArgs, ...restArgs]));
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
            const reason = actionArgs.join(" ").trim() || "rejected from Hermes shell";
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
          console.log(await hermesCommand("memory", [query], 20_000));
          break;
        }
        case "logs": {
          const query = [...subArgs, ...restArgs].join(" ").trim();
          console.log(await hermesCommand("logs", query ? [query] : [], 20_000));
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
          console.log("Theme comes from Hermes.\n");
          break;
        case "personality":
          console.log("Personality is controlled by the Hermes frontend.\n");
          break;
        case "fortune":
          console.log(await hermesCommand("fortune", []));
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
  /doctor             Run Hermes diagnostics
  /usage              Show usage stats
  /setup              Run first-run setup wizard
  /model              Configure model provider
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
  /task <id> [action] Inspect or control a task
  /memory <query>     Search memory
  /logs [query]       Search logs
  /log <index> [action] Inspect a log entry
  /theme              Show theme source
  /personality        Show personality source
  /fortune            Random wisdom
  /help               Show this help
`);
  }

  private showStatus(): void {
    console.log(`Session: ${this.sessionId}`);
    console.log(
      `Bridge: ${process.env.HERMES_BRIDGE_URL || "http://127.0.0.1:3456"}`,
    );
    console.log(`Hermes root: ${PATHS.hermesRoot}`);
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
}
