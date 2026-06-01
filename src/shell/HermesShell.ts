// HermesShell - the TypeScript interactive shell that connects to the
// Agentix backend via HTTP bridge. Slash commands delegate to Python CLI
// for real product behavior (setup, model, cron, gateway, etc.)

import * as readline from "readline";
import { AgentixBackend } from "../agentix_backend.js";
import { hermesCommand } from "./hermes_python_bridge.js";
import { PATHS } from "../config/paths.js";

export class HermesShell {
  private backend: AgentixBackend;
  private rl: readline.Interface;
  private sessionId: string = "default";
  private history: Array<{ role: string; content: string }> = [];

  constructor() {
    this.backend = new AgentixBackend();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
  }

  async start(): Promise<void> {
    console.log("Agentix (Hermes frontend) — type /help for commands\n");

    this.rl.on("line", async (line) => {
      const input = line.trim();
      if (!input) return;

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

  private async handleSlashCommand(input: string): Promise<void> {
    const [cmd, ...args] = input.slice(1).split(/\n+/);
    const parts = cmd.split(" ");
    const name = parts[0].toLowerCase();
    const subArgs = parts.slice(1);

    try {
      switch (name) {
        case "help":
          this.printHelp();
          break;

        case "new":
          this.sessionId = `session-${Date.now()}`;
          this.history = [];
          console.log("→ New session started.\n");
          break;

        case "reset":
          this.history = [];
          console.log("→ Context reset.\n");
          break;

        case "status":
          await this.showStatus();
          break;

        case "history":
          this.showHistory();
          break;

        case "doctor": {
          const out = await hermesCommand("doctor", []);
          console.log(out);
          break;
        }

        case "usage": {
          const out = await hermesCommand("usage", []);
          console.log(out);
          break;
        }

        case "setup": {
          console.log("→ Running Hermes setup wizard...\n");
          const { spawn } = await import("child_process");
          const child = spawn("python", [PATHS.hermesCLI, "setup"], {
            cwd: PATHS.projectRoot,
            stdio: "inherit",
            env: { ...process.env, HERMES_BRIDGE_URL: process.env.HERMES_BRIDGE_URL || "http://127.0.0.1:3456" },
          });
          await new Promise<void>((resolve) => child.on("close", resolve));
          break;
        }

        case "model": {
          console.log("→ Running model configuration...\n");
          const { spawn } = await import("child_process");
          const child = spawn("python", [PATHS.hermesCLI, "model"], {
            cwd: PATHS.projectRoot,
            stdio: "inherit",
            env: { ...process.env, HERMES_BRIDGE_URL: process.env.HERMES_BRIDGE_URL || "http://127.0.0.1:3456" },
          });
          await new Promise<void>((resolve) => child.on("close", resolve));
          break;
        }

        case "update": {
          const out = await hermesCommand("update", ["--check"], 15_000);
          console.log(out);
          break;
        }

        case "cron": {
          const out = await hermesCommand("cron", [...subArgs, ...args]);
          console.log(out);
          break;
        }

        case "gateway": {
          const out = await hermesCommand("gateway", [...subArgs, ...args]);
          console.log(out);
          break;
        }

        case "sessions": {
          const out = await hermesCommand("sessions", [...subArgs, ...args]);
          console.log(out);
          break;
        }

        case "skills": {
          const out = await hermesCommand("skills", [...subArgs, ...args]);
          console.log(out);
          break;
        }

        case "tools": {
          const out = await hermesCommand("tools", [...subArgs, ...args]);
          console.log(out);
          break;
        }

        case "memory": {
          const query = args.join(" ").trim() || subArgs.join(" ");
          if (!query) {
            console.log("Usage: /memory <search-query>\n");
          } else {
            const out = await hermesCommand("memory", [query], 20_000);
            console.log(out);
          }
          break;
        }

        case "logs": {
          const query = args.join(" ").trim() || subArgs.join(" ");
          const out = await hermesCommand("logs", query ? [query] : [], 20_000);
          console.log(out);
          break;
        }

        case "theme":
          console.log("Theme is always dark. 😎\n");
          break;

        case "personality":
          console.log("Personality: helpful, direct, capable.\n");
          break;

        case "fortune":
          try {
            const out = await hermesCommand("fortune", []);
            console.log(out);
          } catch {
            console.log("I'm sorry, I don't have any wisdom to offer you right now.\n");
          }
          break;

        default:
          console.log(`Unknown command: /${name}. Type /help for available commands.\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}\n`);
    }
  }

  private async handleMessage(input: string): Promise<void> {
    this.history.push({ role: "user", content: input });

    try {
      process.stdout.write("→ ");
      await this.forwardStimulusToBackend(input);
      console.log();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\nError: ${msg}\n`);
    }
  }

  private async forwardStimulusToBackend(stimulus: string): Promise<void> {
    let response = "";

    await this.backend.executeStream({
      stimulus,
      sessionId: this.sessionId,
      streamCallback: (delta: string) => {
        process.stdout.write(delta);
        response += delta;
      },
    });

    this.history.push({ role: "assistant", content: response });
  }

  private printHelp(): void {
    console.log(`Available commands:
  /new                Start a new session
  /reset              Clear conversation context
  /status             Show current session and model
  /history            Show conversation history
  /doctor             Run system diagnostic (Python CLI)
  /usage              Show API usage stats (Python CLI)
  /setup              Run first-run setup wizard (Python CLI)
  /model              Configure model provider (Python CLI)
  /update             Check for updates (Python CLI)
  /cron <args>        Manage scheduled tasks (Python CLI)
  /gateway <args>     Manage API gateway (Python CLI)
  /sessions <args>    Manage sessions (Python CLI)
  /skills <args>      Manage skills (Python CLI)
  /tools <args>       Manage tools (Python CLI)
  /memory <query>     Search conversation memory (Python CLI)
  /logs [query]       Search logs (Python CLI)
  /theme              Show current theme
  /personality        Show current personality
  /fortune            Random wisdom
  /help               Show this help
`);
  }

  private async showStatus(): Promise<void> {
    console.log(`Session: ${this.sessionId}`);
    console.log(`Bridge: ${process.env.HERMES_BRIDGE_URL || "http://127.0.0.1:3456"}`);
    console.log(`Install root: ${PATHS.installRoot}`);
    console.log();
  }

  private showHistory(): void {
    if (this.history.length === 0) {
      console.log("(no history)\n");
      return;
    }
    for (const msg of this.history) {
      const label = msg.role === "user" ? "You" : "Assistant";
      console.log(`[${label}] ${msg.content.slice(0, 80)}${msg.content.length > 80 ? "..." : ""}`);
    }
    console.log();
  }
}