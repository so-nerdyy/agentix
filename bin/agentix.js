#!/usr/bin/env node
// bin/agentix.js - Smart routing launcher for Agentix.
// Routes user-facing Hermes commands to Python CLI, backend commands to Node.js.

import { spawn } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Backend commands owned by Agentix Node.js (not Hermes)
// ---------------------------------------------------------------------------
const BACKEND_COMMANDS = new Set([
  "server", "support", "mods", "plugin", "extension",
  "broadcast", "eval", "shell",
]);

// ---------------------------------------------------------------------------
// Hermes UX commands routed to Python hermes_cli.main
// ---------------------------------------------------------------------------
const HERMES_COMMANDS = new Set([
  "setup", "model", "update", "doctor", "usage",
  "cron", "gateway", "sessions", "skills", "tools",
  "memory", "logs", "auth", "config", "plugins",
  "fortune",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function bridgeUrl() {
  return process.env.AGENTIX_BRIDGE_URL || process.env.HERMES_BRIDGE_URL || "http://127.0.0.1:3456";
}

function healthCheck(timeoutMs = 2000) {
  return new Promise<boolean>((resolve) => {
    const req = http.get(`${bridgeUrl()}/health`, { timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

/**
 * Ensure the Node.js bridge server is running.
 * If the bridge is not responding, spawn it as a detached background process.
 */
async function ensureBridgeRunning() {
  const alive = await healthCheck();
  if (alive) return;

  console.error("[agentix] Bridge not running, starting it...");
  const child = spawn("node", [resolve(PROJECT_ROOT, "dist", "bridge", "entry.js")], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  // Give the bridge time to bind
  await new Promise((r) => setTimeout(r, 900));

  if (!(await healthCheck(3000))) {
    console.error("[agentix] WARNING: Bridge failed to start. Commands may not work.");
  }
}

/**
 * Spawn a Python subcommand using hermes_cli.main as the entrypoint.
 * Runs with stdio: inherit so the user interacts with the wizard directly.
 */
async function spawnHermes(args) {
  const pythonCmd = "python";
  const cliMain = resolve(PROJECT_ROOT, "hermes-agent", "hermes_cli", "main.py");

  const child = spawn(pythonCmd, [cliMain, ...args], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      HERMES_BRIDGE_URL: bridgeUrl(),
      AGENTIX_BRIDGE_URL: bridgeUrl(),
      AGENTIX_FRONTEND: "hermes",
      AGENTIX_INSTALL_ROOT: PROJECT_ROOT,
    },
  });

  await new Promise<void>((resolve) => {
    child.on("close", (code) => {
      if (code === 0) resolve();
      else process.exit(code ?? 1);
    });
  });
}

// ---------------------------------------------------------------------------
// Main routing logic
// ---------------------------------------------------------------------------
async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  // No args + interactive TTY → launch TypeScript HermesShell with bridge
  if (!cmd && process.stdin.isTTY) {
    await ensureBridgeRunning();
    const shellEntry = resolve(PROJECT_ROOT, "dist", "shell", "entry.js");
    const child = spawn(process.execPath, [shellEntry], {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        HERMES_BRIDGE_URL: bridgeUrl(),
        AGENTIX_BRIDGE_URL: bridgeUrl(),
      },
    });
    await new Promise<void>((resolve) => child.on("close", resolve));
    return;
  }

  // Version flag
  if (cmd === "version" || cmd === "--version" || cmd === "-V") {
    console.log("Agentix 2.1.0");
    return;
  }

  // Help flag
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    if (args[0] && HERMES_COMMANDS.has(args[0])) {
      await spawnHermes(["--help", args[0]]);
    } else {
      console.log(`Agentix 2.1.0

Usage: agentix [command] [options]

Commands:
  setup          First-run setup wizard (Python)
  model          Configure model provider (Python)
  update         Check for updates (Python)
  doctor         Run system diagnostics (Python)
  usage          Show API usage stats (Python)
  cron           Manage scheduled tasks (Python)
  gateway        Manage API gateway (Python)
  sessions       Manage sessions (Python)
  skills         Manage skills (Python)
  tools          Manage tools (Python)
  memory [q]     Search conversation memory (Python)
  logs [q]       Search logs (Python)
  server         Start backend server (Node.js)
  support        Get support info (Node.js)
  mods           Manage mods (Node.js)

No command + TTY: starts interactive shell (Node.js + Python bridge)

See 'agentix help <command>' for subcommand-specific help.
`);
    }
    return;
  }

  // Backend commands stay on Node.js
  if (cmd && BACKEND_COMMANDS.has(cmd)) {
    await ensureBridgeRunning();
    if (cmd === "server") {
      const { startBridge } = await import(resolve(PROJECT_ROOT, "dist", "bridge", "server.js"));
      await startBridge();
      return;
    }
    console.log(`Backend command '${cmd}' routed to Agentix backend.`);
    return;
  }

  // Default: route to Hermes Python CLI
  await spawnHermes([cmd, ...args].filter(Boolean));
}

main().catch((err) => {
  console.error(`agentix: ${err.message}`);
  process.exit(1);
});