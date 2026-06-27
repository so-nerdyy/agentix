#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync } from "fs";
import { spawn, spawnSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import os from "os";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const WORKSPACE_ROOT = process.cwd();
const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const BACKEND_COMMANDS = new Set([
  "server",
  "dashboard",
  "ui",
  "web",
  "support",
  "plans",
  "plan",
  "tasks",
  "task",
  "approvals",
  "approval",
  "search",
  "audit",
  "healing",
  "agents",
  "auth",
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
  "status",
  "usage",
  "insights",
  "cron",
  "gateway",
  "sessions",
  "skills",
  "tools",
  "memory",
  "logs",
  "config",
  "plugins",
  "fortune",
  "dashboard",
  "web",
]);

const BRIDGELESS_HERMES_COMMANDS = new Set([
  "setup",
  "model",
  "update",
  "plugins",
  "skills",
  "fortune",
]);

const AGENTIX_COMMAND_HELP = new Set(["gateway", "logs"]);

const AGENTIX_HERMES_HOME = process.env.HERMES_HOME
  ? resolve(process.env.HERMES_HOME)
  : join(WORKSPACE_ROOT, ".agentix", "hermes");

function buildLauncherHelp() {
  return [
    `Agentix v${pkg.version}`,
    "",
    "Usage:",
    "  agentix                 open the Hermes-style interactive shell",
    "  agentix <command>       run a shell or backend command",
    "",
    "Hermes shell commands:",
    "  setup                   first-run setup wizard",
    "  model                   configure provider/model",
    "  update                  check for updates",
    "  doctor                  validate config/runtime health",
    "  status                  summarize backend health and runtime counts",
    "  usage                   inspect Agentix backend runtime usage",
    "  insights                inspect Hermes session analytics",
    "  cron                    manage scheduled jobs",
    "  gateway                 manage integrations",
    "  sessions                inspect sessions",
    "  skills                  manage skills/plugins",
    "  tools                   manage tools",
    "  memory                  inspect memory",
    "  logs                    inspect Agentix runtime logs",
    "  auth                    manage Agentix workspace API tokens",
    "  config                  inspect workspace config",
    "  plugins                 list installed plugins",
    "  fortune                 show a status/summary message",
    "",
    "Agentix backend commands:",
    "  server                  start the backend bridge/API and inbox server",
    "                         flags: --port <n> --bridge-port <n> --host <addr>",
    "  dashboard, ui, web      start the web control surface only",
    "                         flags: --port <n> --host <addr>",
    "  support                 create a support bundle",
    "  plans, plan             inspect Symphony plan executions",
    "  tasks, task             list tasks or inspect/control one task",
    "  approvals, approval     list approvals or decide one task",
    "  search                   search backend runtime records",
    "  audit                    list or inspect audit entries",
    "  healing                  inspect/manage healing procedures",
    "  agents                   manage dynamic command-backed Pi profiles",
    "  mods                    list available tools/modules",
    "  plugin, extension       plugin compatibility helpers",
    "  broadcast, eval, shell   backend compatibility entrypoints",
    "  version                 print the installed version",
    "",
    "Tips:",
    "  agentix help <command>   show command-specific help when available",
    "  agentix --agentix-cli    bypass the Hermes shell and use the backend CLI directly",
  ].join("\n");
}

function buildCommandHelp(command) {
  switch (command) {
    case "server":
      return [
        "Usage: agentix server",
        "",
        "Starts the backend bridge/API and inbox server.",
        "The server exposes the Agentix runtime, dashboard APIs, scheduler, logs,",
        "memory, healing, support bundle, and event stream endpoints.",
      ].join("\n");
    case "dashboard":
    case "ui":
    case "web":
      return [
        `Usage: agentix ${command}`,
        "",
        "Starts the web control surface only.",
        "Use this when you want the dashboard without launching the full bridge.",
      ].join("\n");
    case "gateway":
      return [
        "Usage: agentix gateway [gateway-id] [inspect|enable|disable|message <stimulus>]",
        "",
        "Inspects or manages gateway integrations from the Agentix backend runtime.",
      ].join("\n");
    case "logs":
      return [
        "Usage: agentix logs",
        "",
        "Prints recent persisted runtime log entries from the Agentix backend.",
      ].join("\n");
    case "support":
      return [
        "Usage: agentix support",
        "",
        "Creates a timestamped support bundle under data/support/ with runtime snapshots,",
        "logs, memory, tasks, approvals, jobs, healing state, and config metadata.",
      ].join("\n");
    case "plans":
      return [
        "Usage: agentix --agentix-cli plans",
        "",
        "Lists Symphony plan executions from the Agentix backend.",
      ].join("\n");
    case "plan":
      return [
        "Usage: agentix --agentix-cli plan <plan-id> [replay|cancel|retry-failed]",
        "",
        "Prints the full Symphony plan execution record as JSON, or controls execution:",
        "  replay       run the original stimulus again in the same session",
        "  cancel       cancel open child tasks for the plan",
        "  retry-failed retry failed/rejected child tasks",
      ].join("\n");
    case "tasks":
      return [
        "Usage: agentix tasks [session-id]",
        "",
        "Lists backend tasks, optionally filtered to one session.",
      ].join("\n");
    case "task":
      return [
        "Usage: agentix task <task-id> [inspect|approve|reject|cancel|retry|restart] [reason]",
        "",
        "Inspects or controls one backend task.",
      ].join("\n");
    case "approvals":
      return [
        "Usage: agentix approvals",
        "",
        "Lists tasks awaiting approval.",
      ].join("\n");
    case "approval":
      return [
        "Usage: agentix approval <task-id> [inspect|approve|reject] [reason]",
        "",
        "Inspects or decides one approval.",
      ].join("\n");
    case "search":
      return [
        "Usage: agentix search <query>",
        "",
        "Searches tasks, sessions, memory, logs, audit, jobs, plans, healing, and gateways.",
      ].join("\n");
    case "audit":
      return [
        "Usage: agentix audit [audit-id]",
        "",
        "Lists audit entries or prints one detailed entry.",
      ].join("\n");
    case "healing":
      return [
        "Usage: agentix healing [fingerprint|procedure-id] [inspect|promote|deprecate]",
        "",
        "Inspects healing state and manages learned recovery procedures.",
      ].join("\n");
    case "agents":
      return [
        "Usage: agentix agents [list|create <id> <kind> <command...>|enable <id>|disable <id>]",
        "",
        "Manages dynamic command-backed Pi agent profiles.",
        "Command profiles are approval-gated and receive task JSON on stdin.",
      ].join("\n");
    case "auth":
      return [
        "Usage: agentix auth [status|list|create [viewer|operator|admin] [label]|revoke <token-id>]",
        "",
        "Manages Agentix workspace API tokens.",
        "Env AGENTIX_SESSION_TOKEN remains an admin compatibility token.",
        "Created workspace tokens are shown once and stored hashed under data/auth/.",
      ].join("\n");
    case "mods":
    case "plugin":
    case "extension":
      return [
        `Usage: agentix ${command}`,
        "",
        "Lists available tools/modules from the backend runtime.",
      ].join("\n");
    case "eval":
    case "broadcast":
      return [
        `Usage: agentix ${command} <stimulus>`,
        "",
        "Runs a stimulus directly through the Agentix backend and prints the result.",
      ].join("\n");
    case "shell":
      return [
        "Usage: agentix",
        "",
        "Open the Hermes-style interactive shell from the current folder.",
      ].join("\n");
    case "version":
      return [
        "Usage: agentix version",
        "",
        "Prints the installed Agentix version.",
      ].join("\n");
    default:
      return buildLauncherHelp();
  }
}

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
const VENV_ROOT = resolve(
  process.env.AGENTIX_HERMES_VENV || join(os.homedir(), ".agentix", "hermes-python"),
);

function bridgeUrl() {
  return (
    process.env.AGENTIX_BRIDGE_URL ||
    process.env.HERMES_BRIDGE_URL ||
    "http://127.0.0.1:3456"
  );
}

function parseEnvFile(file) {
  if (!existsSync(file)) {
    return {};
  }

  const env = {};
  const content = readFileSync(file, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const [rawKey, ...rawValue] = line.split("=");
    const key = rawKey.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    let value = rawValue.join("=").trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function parseScalar(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
}

function parseHermesModelConfig(file) {
  if (!existsSync(file)) {
    return {};
  }

  const model = {};
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  let inModel = false;
  let modelIndent = 0;

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) {
      continue;
    }
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const line = rawLine.trim();

    if (!inModel) {
      if (line.startsWith("model:")) {
        const inline = parseScalar(line.slice("model:".length));
        if (inline) {
          model.default = inline;
        }
        inModel = true;
        modelIndent = indent;
      }
      continue;
    }

    if (indent <= modelIndent && !line.startsWith("-")) {
      break;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    const value = parseScalar(match[2]);
    if (key === "default") model.default = value;
    if (key === "provider") model.provider = value;
    if (key === "base_url" || key === "baseUrl") model.baseUrl = value;
  }

  return model;
}

function providerKeyCandidates(provider) {
  const normalized = String(provider || "").toLowerCase();
  if (normalized.includes("anthropic") || normalized.includes("claude")) {
    return ["ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN"];
  }
  if (normalized.includes("openrouter")) {
    return ["OPENROUTER_API_KEY", "OPENAI_API_KEY"];
  }
  if (normalized.includes("gemini") || normalized.includes("google")) {
    return ["GEMINI_API_KEY", "GOOGLE_API_KEY"];
  }
  if (normalized.includes("deepseek")) {
    return ["DEEPSEEK_API_KEY", "OPENAI_API_KEY"];
  }
  if (normalized.includes("groq")) {
    return ["GROQ_API_KEY", "OPENAI_API_KEY"];
  }
  if (normalized.includes("mistral")) {
    return ["MISTRAL_API_KEY", "OPENAI_API_KEY"];
  }
  if (normalized.includes("xai") || normalized.includes("grok")) {
    return ["XAI_API_KEY", "OPENAI_API_KEY"];
  }
  return ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"];
}

function buildRuntimeEnv(extra = {}) {
  const hermesEnv = parseEnvFile(join(AGENTIX_HERMES_HOME, ".env"));
  const workspaceEnv = parseEnvFile(join(WORKSPACE_ROOT, ".env.local"));
  const modelConfig = parseHermesModelConfig(join(AGENTIX_HERMES_HOME, "config.yaml"));
  const env = {
    ...hermesEnv,
    ...workspaceEnv,
    ...process.env,
    ...extra,
    HERMES_HOME: process.env.HERMES_HOME || AGENTIX_HERMES_HOME,
    AGENTIX_INSTALL_ROOT: PROJECT_ROOT,
    AGENTIX_WORKSPACE_DIR: WORKSPACE_ROOT,
  };

  if (!env.AGENTIX_MODEL && modelConfig.default) {
    env.AGENTIX_MODEL = modelConfig.default;
  }
  if (!env.AGENTIX_PROVIDER && modelConfig.provider) {
    env.AGENTIX_PROVIDER = modelConfig.provider;
  }
  if (!env.AGENTIX_BASE_URL && modelConfig.baseUrl) {
    env.AGENTIX_BASE_URL = modelConfig.baseUrl;
  }
  if (!env.AGENTIX_BASE_URL && env.OPENAI_BASE_URL) {
    env.AGENTIX_BASE_URL = env.OPENAI_BASE_URL;
  }
  if (!env.AGENTIX_LLM_API_KEY) {
    for (const keyName of providerKeyCandidates(env.AGENTIX_PROVIDER || modelConfig.provider)) {
      if (env[keyName]) {
        env.AGENTIX_LLM_API_KEY = env[keyName];
        break;
      }
    }
  }

  return env;
}

function healthCheck(timeoutMs = 2000) {
  return new Promise((resolveHealth) => {
    let settled = false;
    const finish = (healthy) => {
      if (settled) {
        return;
      }
      settled = true;
      resolveHealth(healthy);
    };

    const req = http.get(`${bridgeUrl()}/health`, { timeout: timeoutMs }, (res) => {
      const healthy = res.statusCode === 200;
      res.resume();
      res.on("end", () => finish(healthy));
      res.on("error", () => finish(false));
    });
    req.on("error", () => finish(false));
    req.on("timeout", () => {
      req.destroy();
      finish(false);
    });
  });
}

async function waitForBridgeHealth(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthCheck(1000)) {
      return true;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  return false;
}

function venvPython() {
  return process.platform === "win32"
    ? resolve(VENV_ROOT, "Scripts", "python.exe")
    : resolve(VENV_ROOT, "bin", "python");
}

function pythonCandidates() {
  const configured = process.env.AGENTIX_PYTHON || process.env.PYTHON;
  const candidates = [];
  if (configured) candidates.push({ command: configured, args: [] });
  candidates.push({ command: "python3", args: [] });
  candidates.push({ command: "python", args: [] });
  if (process.platform === "win32") candidates.push({ command: "py", args: ["-3"] });
  return candidates;
}

function resolveSystemPython() {
  for (const candidate of pythonCandidates()) {
    const check = spawnSync(candidate.command, [...candidate.args, "--version"], {
      cwd: PROJECT_ROOT,
      stdio: "ignore",
    });
    if (check.status === 0) return candidate;
  }
  throw new Error(
    "Python 3 is required for the Hermes frontend. Set AGENTIX_PYTHON to a Python 3 executable if auto-detection fails.",
  );
}

function ensureVenv() {
  if (existsSync(venvPython())) {
    return venvPython();
  }

  mkdirSync(VENV_ROOT, { recursive: true });
  const python = resolveSystemPython();
  const created = spawnSync(python.command, [...python.args, "-m", "venv", VENV_ROOT], {
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
    cwd: WORKSPACE_ROOT,
    detached: true,
    stdio: "ignore",
    env: buildRuntimeEnv(),
  });
  child.unref();

  if (!(await waitForBridgeHealth(10000))) {
    throw new Error("Agentix bridge failed to start");
  }
}

async function spawnHermes(args) {
  const pythonExe = ensureVenv();
  ensureHermesInstalled(pythonExe);

  const child = spawn(pythonExe, ["-m", "hermes_cli.main", ...args], {
    cwd: WORKSPACE_ROOT,
    stdio: "inherit",
    env: buildRuntimeEnv({
      PYTHONPATH: HERMES_ROOT,
      HERMES_BRIDGE_URL: bridgeUrl(),
      AGENTIX_BRIDGE_URL: bridgeUrl(),
      AGENTIX_FRONTEND: "hermes",
    }),
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
    cwd: WORKSPACE_ROOT,
    stdio: "inherit",
    env: buildRuntimeEnv({
      AGENTIX_BRIDGE_URL: bridgeUrl(),
      HERMES_BRIDGE_URL: bridgeUrl(),
    }),
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
      cwd: WORKSPACE_ROOT,
      stdio: "inherit",
      env: buildRuntimeEnv({
        AGENTIX_BRIDGE_URL: bridgeUrl(),
        HERMES_BRIDGE_URL: bridgeUrl(),
      }),
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
    if (!args[0]) {
      console.log(buildLauncherHelp());
      return;
    }
    if (BACKEND_COMMANDS.has(args[0]) || AGENTIX_COMMAND_HELP.has(args[0])) {
      console.log(buildCommandHelp(args[0]));
      return;
    }
    if (HERMES_COMMANDS.has(args[0])) {
      await spawnHermes([args[0], "--help"]);
      return;
    }
    await spawnHermes(["--help"]);
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    if (BACKEND_COMMANDS.has(cmd) || AGENTIX_COMMAND_HELP.has(cmd)) {
      console.log(buildCommandHelp(cmd));
      return;
    }
    if (HERMES_COMMANDS.has(cmd)) {
      await spawnHermes([cmd, "--help"]);
      return;
    }
  }

  if (cmd && BACKEND_COMMANDS.has(cmd)) {
    await spawnNodeCli([cmd, ...args]);
    return;
  }

  if (cmd && HERMES_COMMANDS.has(cmd) && BRIDGELESS_HERMES_COMMANDS.has(cmd)) {
    await spawnHermes([cmd, ...args]);
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
