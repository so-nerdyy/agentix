import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";

const launcherPath = join(process.cwd(), "bin", "agentix.js");

function launcherSource() {
  return [
    readFileSync(launcherPath, "utf8"),
    readFileSync(join(process.cwd(), "bin", "agentix-main.js"), "utf8"),
  ].join("\n");
}

function commandSet(name: string) {
  const launcher = launcherSource();
  const match = launcher.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  expect(match).not.toBeNull();
  return new Set(Array.from(match![1].matchAll(/"([^"]+)"/g), (item) => item[1]));
}

describe("launcher help", () => {
  it("advertises the merged shell and backend command surface", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "--help"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("open the Agentix interactive shell");
    expect(result.stdout).toContain("Agentix commands:");
    expect(result.stdout).toContain("Agentix backend commands:");
    expect(result.stdout).toContain("setup");
    expect(result.stdout).toContain("server");
    expect(result.stdout).toContain("support");
    expect(result.stdout).toContain("plans");
    expect(result.stdout).toContain("tasks, task");
    expect(result.stdout).toContain("approvals, approval");
    expect(result.stdout).toContain("healing");
    expect(result.stdout).toContain("agents");
    expect(result.stdout).toContain("--bridge-port");
  });

  it("documents complete dynamic Pi profile lifecycle controls", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "agents", "--help"], {
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("create <id> <kind> <command...>");
    expect(result.stdout).toContain("enable <id>");
    expect(result.stdout).toContain("disable <id>");
    expect(result.stdout).toContain("delete <id>");
  });

  it("shows command help instead of starting backend commands", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "server", "--help"], {
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: agentix server");
    expect(result.stdout).toContain("backend bridge/API and inbox server");
    expect(result.stdout).not.toContain("Agentix dashboard available");
  });

  it("prints local help for help <backend-command>", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "help", "server"], {
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: agentix server");
    expect(result.stdout).toContain("backend bridge/API and inbox server");
  });

  it("prints version directly without booting the backend CLI", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "version"], {
      encoding: "utf8",
      timeout: 5_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^Agentix v\d+\.\d+\.\d+/);
    expect(result.stderr).toBe("");
  });

  it("uses the public npm package scope in update help", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "help", "update"], {
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("npm install -g @nerdyy/agentix");
    expect(result.stdout).not.toContain("@so-nerdyy/agentix");
  });

  it("routes Hermes-style one-shot mode through the Agentix backend CLI", () => {
    const launcher = launcherSource();

    expect(launcher).toContain("function translateOneshotArgs");
    expect(launcher).toContain('cmd === "-z"');
    expect(launcher).toContain('cmd === "--oneshot"');
    expect(launcher).toContain('spawnNodeCli(["oneshot", ...translateOneshotArgs(argv)])');
  });

  it("prints Agentix help for backend-adapted compatibility commands", () => {
    const gateway = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "gateway", "--help"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    const logs = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "help", "logs"], {
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(gateway.status).toBe(0);
    expect(gateway.stdout).toContain("Agentix backend runtime");
    expect(logs.status).toBe(0);
    expect(logs.stdout).toContain("persisted runtime log entries");
  });

  it("documents launch flags for dashboard and server", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "--help"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("flags: --port <n> --bridge-port <n> --host <addr>");
    expect(result.stdout).toContain("flags: --port <n> --host <addr>");
  });

  it("routes Agentix-owned commands through the backend CLI", () => {
    const backendCommands = commandSet("BACKEND_COMMANDS");
    const frontendCommands = commandSet("FRONTEND_COMPAT_COMMANDS");
    const bridgelessCommands = commandSet("BRIDGELESS_FRONTEND_COMMANDS");

    expect(backendCommands).toContain("doctor");
    expect(backendCommands).toContain("status");
    expect(backendCommands).toContain("usage");
    expect(backendCommands).toContain("config");
    expect(backendCommands).toContain("sessions");
    expect(backendCommands).toContain("memory");
    expect(backendCommands).toContain("cron");
    expect(backendCommands).toContain("gateway");
    expect(backendCommands).toContain("logs");
    expect(backendCommands).toContain("tools");
    expect(backendCommands).toContain("task");
    expect(backendCommands).toContain("approval");
    expect(backendCommands).toContain("search");
    expect(backendCommands).toContain("audit");
    expect(backendCommands).toContain("healing");
    expect(backendCommands).toContain("agents");
    expect(backendCommands).toContain("auth");
    expect(frontendCommands).not.toContain("doctor");
    expect(frontendCommands).not.toContain("config");
    expect(frontendCommands).not.toContain("gateway");
    expect(frontendCommands).not.toContain("logs");
    expect(frontendCommands).not.toContain("auth");
    expect(bridgelessCommands).not.toContain("auth");
  });

  it("does not start the bridge for setup/model before configuration exists", () => {
    const launcher = launcherSource();

    expect(launcher).toContain('if (cmd === "setup")');
    expect(launcher).toContain('if (cmd === "model")');
    expect(launcher).toContain('if (cmd === "options")');
    expect(launcher).toContain("writeWorkspaceEnv");
    expect(launcher).toContain("writeWorkspaceConfig");
    expect(launcher).toContain("AGENTIX_FRONTEND_HOME");
    expect(launcher).toContain("parseFrontendModelConfig");
    expect(launcher).toContain("AGENTIX_LLM_API_KEY");
    expect(launcher).toContain("process.env.KILO_API_KEY");
    expect(launcher).toContain("async function printLiveModelOptions");
    expect(launcher).toContain('"kilo-auto/free"');
    expect(launcher).toContain('args.includes("--list")');
    expect(launcher).toContain('args.includes("--live")');
  });

  it("never prints an existing API key during piped setup", () => {
    const workspace = mkdtempSync(join(tmpdir(), "agentix-setup-secret-"));
    const secret = "kilo-secret-that-must-not-appear";
    try {
      mkdirSync(join(workspace, "data"), { recursive: true });
      writeFileSync(join(workspace, "data", "config.json"), "{partial", "utf8");
      const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "setup"], {
        cwd: workspace,
        encoding: "utf8",
        input: "kilocode\nkilo-auto/free\nhttps://api.kilo.ai/api/gateway\n\n",
        env: {
          ...process.env,
          AGENTIX_LLM_API_KEY: "",
          KILOCODE_API_KEY: "",
          KILO_API_KEY: secret,
        },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("API key [configured]");
      expect(result.stdout).not.toContain(secret);
      expect(readFileSync(join(workspace, ".env.local"), "utf8")).toContain(`AGENTIX_LLM_API_KEY=${secret}`);
      const backup = readdirSync(join(workspace, "data"))
        .find((name) => name.startsWith("config.json.corrupt-"));
      expect(backup).toBeDefined();
      expect(readFileSync(join(workspace, "data", backup!), "utf8")).toBe("{partial");
      expect(JSON.parse(readFileSync(join(workspace, "data", "config.json"), "utf8"))).toMatchObject({
        provider: "kilocode",
      });
      if (process.platform !== "win32") {
        expect(statSync(join(workspace, ".env.local")).mode & 0o777).toBe(0o600);
        expect(statSync(join(workspace, "data", "config.json")).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("creates a local control token before probing or spawning a protected bridge", () => {
    const launcher = launcherSource();

    expect(launcher).toContain("function ensureLocalBridgeSessionToken");
    expect(launcher).toContain("AGENTIX_SESSION_TOKEN");
    expect(launcher).toContain("ensureLocalBridgeSessionToken();");
    expect(launcher).toContain("agx_local_");
  });

  it("owns and stops fallback bridge processes started for shell commands", () => {
    const launcher = launcherSource();

    expect(launcher).toContain("let managedBridgeChild = null;");
    expect(launcher).toContain("async function stopManagedBridge()");
    expect(launcher).toContain("managedBridgeChild = child;");
    expect(launcher).toContain("async function waitForBridgeReady");
    expect(launcher).toContain("waitForBridgeReady(child, 30000, url)");
    expect(launcher).toContain("const attempts = explicit ? 1 : 2;");
    expect(launcher).toContain("spawn(process.execPath");
    expect(launcher).toContain('stdio: ["ignore", "ignore", "pipe"]');
    expect(launcher).toContain(".then(() => stopManagedBridge())");
    expect(launcher).not.toContain("detached: true");
    expect(launcher).not.toContain("child.unref();");
  });

  it("keeps the fortune command local to Agentix", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "fortune"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    const frontendCommands = commandSet("FRONTEND_COMPAT_COMMANDS");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Agentix: Powerhouse plans, Symphony schedules, Pi agents execute.");
    expect(frontendCommands).not.toContain("fortune");
  });

  it("preserves compatibility subcommands when forwarding their help", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "skills", "reset", "--help"], {
      encoding: "utf8",
      timeout: 60_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("usage: agentix skills reset");
    expect(result.stdout).toContain("agentix update");
    expect(result.stdout).not.toMatch(/hermes|nous portal/i);
  }, 90_000);

  it("opens the Agentix-owned shell for no-argument launches", () => {
    const launcher = launcherSource();

    expect(launcher).toContain("async function spawnNodeShell");
    expect(launcher).toContain("await spawnNodeShell();");
    expect(launcher).not.toContain("if (!cmd && process.stdin.isTTY) {\n    await ensureBridgeRunning();\n    await spawnFrontendCompatibility([]);");
  });

  it("detects Python instead of requiring a literal python command", () => {
    const launcher = launcherSource();
    const bridge = readFileSync(join(process.cwd(), "src", "shell", "agentix_python_bridge.ts"), "utf8");

    expect(launcher).toContain("AGENTIX_PYTHON");
    expect(launcher).toContain("python3");
    expect(launcher).toContain("py\", args: [\"-3\"]");
    expect(launcher.indexOf('command: "python"')).toBeLessThan(launcher.indexOf('command: "py"'));
    expect(bridge.indexOf('command: "python"')).toBeLessThan(bridge.indexOf('command: "py"'));
    expect(launcher).not.toContain('spawnSync("python", ["-m", "venv"');
  });

  it("rejects unknown commands without exposing compatibility-only commands", () => {
    const result = spawnSync(process.execPath, [launcherPath, "run", "--invalid-flag"], {
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown Agentix command: run");
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/hermes|nous|portal|claw/i);
  });

  it("prints startup feedback before loading the full launcher", () => {
    const bootstrap = readFileSync(launcherPath, "utf8");

    expect(bootstrap.length).toBeLessThan(1_000);
    expect(bootstrap).toContain('process.stdout.write("Starting Agentix...\\n")');
    expect(bootstrap.indexOf("process.stdout.write")).toBeLessThan(bootstrap.indexOf('import("./agentix-main.js")'));
  });

  it("keeps the interactive shell on Agentix backend commands", () => {
    const shell = readFileSync(join(process.cwd(), "src", "shell", "AgentixShell.ts"), "utf8");

    expect(shell).toContain("export class AgentixShell");
    expect(shell).toContain('this.rl.setPrompt("agentix> ")');
    expect(shell).toContain("this.printBanner();");
    expect(shell).toContain("Powerhouse orchestrates. Symphony plans. Pi agents execute.");
    expect(shell).toContain("private commandQueue: Promise<void> = Promise.resolve();");
    expect(shell).toContain("Frontend: Agentix terminal shell");
    expect(shell).not.toContain("compatibilityRuntimeRoot");
    expect(shell).toContain("this.rl.prompt();");
    expect(shell).toContain("this.backend.usage()");
    expect(shell).toContain("this.backend.listSessions");
    expect(shell).toContain("loadSessionHistory");
    expect(shell).toContain("detail.messages");
    expect(shell).toContain("this.backend.listTools()");
    expect(shell).toContain("this.backend.listAgentProfiles()");
    expect(shell).toContain("this.backend.deleteAgentProfile(profileId)");
    expect(shell).toContain('case "tasks"');
    expect(shell).toContain('case "approvals"');
    expect(shell).toContain('case "audits"');
    expect(shell).toContain('case "gateways"');
    expect(shell).toContain('case "jobs"');
    expect(shell).not.toContain("process.exit(0)");
    expect(shell).not.toContain("runLegacyInteractive");
    expect(shell).not.toContain("compatibilityCommand");
    expect(shell).not.toContain("spawnFrontendCompatibility");
  });

  it("prints a visible prompt for no-argument shell launches", () => {
    const workspace = mkdtempSync(join(tmpdir(), "agentix-shell-prompt-"));
    try {
      const result = spawnSync(process.execPath, [launcherPath], {
        cwd: workspace,
        env: {
          ...process.env,
          AGENTIX_DATA_DIR: join(workspace, "data"),
          AGENTIX_WORKSPACE_DIR: workspace,
        },
        encoding: "utf8",
        input: "/exit\n",
        timeout: 30_000,
      });

      expect(result.status).toBe(0);
      const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };
      expect(result.stdout).toContain(`Agentix v${version}`);
      expect(result.stdout).toContain("Powerhouse orchestrates. Symphony plans. Pi agents execute.");
      expect(result.stdout).toContain("Type a message to create a task, or /help for commands.");
      expect(result.stdout).toContain("agentix>");
      expect(result.stderr).toBe("");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 60_000);

  it("serializes the complete pasted shell command inventory before exiting", () => {
    const workspace = mkdtempSync(join(tmpdir(), "agentix-shell-commands-"));
    try {
      const commands = [
        "/help", "/status", "/history", "/doctor", "/usage", "/setup", "/model", "/options", "/update",
        "/cron", "/job", "/gateways", "/gateway", "/sessions", "/session", "/agents", "/agent",
        "/approvals", "/approval", "/healing", "/audits", "/audit", "/skills", "/tools", "/tool",
        "/search no-match-expected", "/plans", "/plan", "/tasks", "/task", "/memory", "/logs", "/log",
        "/theme", "/personality", "/fortune", "/new", "/reset", "/exit",
      ];
      const result = spawnSync(process.execPath, [launcherPath], {
        cwd: workspace,
        env: {
          ...process.env,
          AGENTIX_DATA_DIR: join(workspace, "data"),
          AGENTIX_WORKSPACE_DIR: workspace,
        },
        encoding: "utf8",
        input: `${commands.join("\n")}\n`,
        timeout: 60_000,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Available commands:");
      expect(result.stdout).toContain("Frontend: Agentix terminal shell");
      expect(result.stdout).toContain("Agentix backend doctor:");
      expect(result.stdout).toContain("Agentix backend usage");
      expect(result.stdout).toContain("Run `agentix setup`");
      expect(result.stdout).toContain("Run `agentix model`");
      expect(result.stdout).toContain("Powerhouse plans, Symphony schedules, Pi agents execute.");
      expect(result.stdout).toContain("New session started");
      expect(result.stdout).toContain("Context reset");
      expect(result.stdout).toContain("No tasks.");
      expect(result.stdout).toContain("No pending approvals.");
      expect(result.stdout).toContain("Configured gateways:");
      expect(result.stdout).not.toContain("Unknown command:");
      expect(result.stdout).not.toMatch(/hermes|nous portal/i);
      expect(result.stderr).toBe("");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 60_000);
});
