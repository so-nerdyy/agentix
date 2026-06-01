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
        case "gateway":
          console.log(await hermesCommand("gateway", [...subArgs, ...restArgs]));
          break;
        case "sessions":
          console.log(await hermesCommand("sessions", [...subArgs, ...restArgs]));
          break;
        case "skills":
          console.log(await hermesCommand("skills", [...subArgs, ...restArgs]));
          break;
        case "tools":
          console.log(await hermesCommand("tools", [...subArgs, ...restArgs]));
          break;
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
  /gateway <args>     Manage gateway integrations
  /sessions <args>    Manage sessions
  /skills <args>      Manage skills
  /tools <args>       Manage tools
  /memory <query>     Search memory
  /logs [query]       Search logs
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
}
