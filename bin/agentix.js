#!/usr/bin/env node

import { existsSync, mkdirSync } from "fs";
import { spawn, spawnSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import os from "os";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const BACKEND_COMMANDS = new Set([
  "server",
  "dashboard",
  "ui",
  "web",
  "support",
  "logs",
  "mods",
  "plugin",
  "extension",
  "broadcast",
  "eval",
  "shell",
  "version",
]);

const HERMES_COMMANDS = new Set([
  "setup",
  "model",
  "update",
  "doctor",
  "usage",
  "cron",
  "gateway",
  "sessions",
  "skills",
  "tools",
  "memory",
  "auth",
  "config",
  "plugins",
  "fortune",
  "dashboard",
  "web",
]);

function resolveHermesRoot() {
  const candidates = [
    resolve(PROJECT_ROOT, "hermes-agent", "hermes-agent-upstream"),
    resolve(PROJECT_ROOT, "hermes-agent-upstream"),
    resolve(PROJECT_ROOT, "hermes-agent"),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "pyproject.toml"))) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1];
}

const HERMES_ROOT = resolveHermesRoot();
const VENV_ROOT = resolve(os.homedir(), ".agentix", "hermes-python");

function bridgeUrl() {
  return (
    process.env.AGENTIX_BRIDGE_URL ||
    process.env.HERMES_BRIDGE_URL ||
    "http://127.0.0.1:3456"
  );
}

function healthCheck(timeoutMs = 2000) {
  return new Promise((resolveHealth) => {
    const req = http.get(`${bridgeUrl()}/health`, { timeout: timeoutMs }, (res) => {
      resolveHealth(res.statusCode === 200);
    });
    req.on("error", () => resolveHealth(false));
    req.on("timeout", () => {
      req.destroy();
      resolveHealth(false);
    });
  });
}

function venvPython() {
  return process.platform === "win32"
    ? resolve(VENV_ROOT, "Scripts", "python.exe")
    : resolve(VENV_ROOT, "bin", "python");
}

function ensureVenv() {
  if (existsSync(venvPython())) {
    return venvPython();
  }

  mkdirSync(VENV_ROOT, { recursive: true });
  const created = spawnSync("python", ["-m", "venv", VENV_ROOT], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });
  if (created.status !== 0) {
    throw new Error("failed to create Hermes Python virtual environment");
  }
  return venvPython();
}

function ensureHermesInstalled(pythonExe) {
  const check = spawnSync(pythonExe, ["-c", "import hermes_cli.main"], {
    cwd: HERMES_ROOT,
    env: {
      ...process.env,
      PYTHONPATH: HERMES_ROOT,
    },
    stdio: "ignore",
  });

  if (check.status === 0) {
    return;
  }

  const installed = spawnSync(pythonExe, ["-m", "pip", "install", "-e", HERMES_ROOT], {
    cwd: HERMES_ROOT,
    stdio: "inherit",
  });
  if (installed.status !== 0) {
    throw new Error("failed to install Hermes frontend dependencies");
  }
}

async function ensureBridgeRunning() {
  if (await healthCheck()) {
    return;
  }

  const child = spawn("node", [resolve(PROJECT_ROOT, "dist", "bridge", "entry.js")], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1200));
  if (!(await healthCheck(3000))) {
    throw new Error("Agentix bridge failed to start");
  }
}

async function spawnHermes(args) {
  const pythonExe = ensureVenv();
  ensureHermesInstalled(pythonExe);

  const child = spawn(pythonExe, ["-m", "hermes_cli.main", ...args], {
    cwd: HERMES_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      PYTHONPATH: HERMES_ROOT,
      HERMES_BRIDGE_URL: bridgeUrl(),
      AGENTIX_BRIDGE_URL: bridgeUrl(),
      AGENTIX_FRONTEND: "hermes",
      AGENTIX_INSTALL_ROOT: PROJECT_ROOT,
    },
  });

  await new Promise((resolveExit) => {
    child.on("close", (code) => {
      if (code === 0) {
        resolveExit();
        return;
      }
      process.exit(code ?? 1);
    });
  });
}

async function spawnNodeCli(args) {
  const child = spawn(process.execPath, [resolve(PROJECT_ROOT, "dist", "cli.js"), ...args], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      AGENTIX_BRIDGE_URL: bridgeUrl(),
      HERMES_BRIDGE_URL: bridgeUrl(),
    },
  });

  await new Promise((resolveExit) => {
    child.on("close", (code) => {
      if (code === 0) {
        resolveExit();
        return;
      }
      process.exit(code ?? 1);
    });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const [cmd, ...args] = argv;

  if (argv.includes("--agentix-cli")) {
    await spawnNodeCli(argv.filter((arg) => arg !== "--agentix-cli"));
    return;
  }

  if (argv.includes("--node-shell")) {
    await ensureBridgeRunning();
    const child = spawn(process.execPath, [resolve(PROJECT_ROOT, "dist", "shell", "entry.js")], {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        AGENTIX_BRIDGE_URL: bridgeUrl(),
        HERMES_BRIDGE_URL: bridgeUrl(),
      },
    });
    await new Promise((resolveExit) => child.on("close", resolveExit));
    return;
  }

  if (!cmd && process.stdin.isTTY) {
    await ensureBridgeRunning();
    await spawnHermes([]);
    return;
  }

  if (cmd === "version" || cmd === "--version" || cmd === "-V") {
    await spawnNodeCli(["version"]);
    return;
  }

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    if (args[0] && HERMES_COMMANDS.has(args[0])) {
      await spawnHermes([args[0], "--help"]);
      return;
    }
    await spawnHermes(["--help"]);
    return;
  }

  if (cmd && BACKEND_COMMANDS.has(cmd)) {
    await spawnNodeCli([cmd, ...args]);
    return;
  }

  await ensureBridgeRunning();
  await spawnHermes(argv.filter(Boolean));
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`agentix ${pkg.version}: ${message}`);
  process.exit(1);
});
