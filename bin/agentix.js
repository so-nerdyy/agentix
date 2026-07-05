#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { spawn, spawnSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import os from "os";
import http from "http";
import net from "net";

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
  "update",
  "doctor",
  "status",
  "readiness",
  "usage",
  "config",
  "sessions",
  "memory",
  "cron",
  "scheduler",
  "gateway",
  "logs",
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
  "tools",
  "plugin",
  "extension",
  "broadcast",
  "eval",
  "shell",
  "version",
]);

const FRONTEND_COMPAT_COMMANDS = new Set([
  "setup",
  "model",
  "options",
  "insights",
  "skills",
  "plugins",
  "fortune",
  "dashboard",
  "web",
]);

const BRIDGELESS_FRONTEND_COMMANDS = new Set([
  "plugins",
  "skills",
  "fortune",
]);

const AGENTIX_COMMAND_HELP = new Set(["gateway", "logs", "tools"]);

function resolveFrontendHome() {
  if (process.env.AGENTIX_FRONTEND_HOME) {
    return resolve(process.env.AGENTIX_FRONTEND_HOME);
  }

  const preferred = join(WORKSPACE_ROOT, ".agentix", "frontend");
  if (existsSync(preferred)) {
    return preferred;
  }
  return preferred;
}

const AGENTIX_FRONTEND_HOME = resolveFrontendHome();
let activeBridgeUrl = null;

function buildLauncherHelp() {
  return [
    `Agentix v${pkg.version}`,
    "",
    "Usage:",
    "  agentix                 open the Agentix interactive shell",
    "  agentix <command>       run a shell or backend command",
    "",
    "Agentix commands:",
    "  setup                   first-run setup wizard",
    "  model                   configure provider/model",
    "  options                 list provider/model/setup options",
    "  update                  check for updates",
    "  doctor                  validate config/runtime health",
    "  status                  summarize backend health and runtime counts",
    "  usage                   inspect Agentix backend runtime usage",
    "  insights                inspect session analytics",
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
    "  readiness               report private-beta and public-release gates",
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
    "  agentix --agentix-cli    bypass the Agentix shell and use the backend CLI directly",
  ].join("\n");
}

function buildSetupHelp() {
  return [
    "Usage: agentix setup [model|options]",
    "",
    "Configures Agentix for the current workspace.",
    "Secrets are written to .env.local; non-secret defaults are synced to data/config.json.",
    "",
    "Sections:",
    "  model      configure provider, model, base URL, and API key",
    "  options    list provider/model/environment options",
    "",
    "Examples:",
    "  agentix setup",
    "  agentix setup model",
    "  agentix setup options",
  ].join("\n");
}

function buildCommandHelp(command) {
  switch (command) {
    case "setup":
      return buildSetupHelp();
    case "model":
      return [
        "Usage: agentix model",
        "",
        "Configures Agentix provider/model/base URL/API key for this workspace.",
        "For Kilo Gateway, use provider `kilocode`, the Kilo model id, and base URL `https://api.kilo.ai/api/gateway`.",
      ].join("\n");
    case "options":
      return [
        "Usage: agentix options [providers|models|env|commands]",
        "",
        "Lists Agentix setup/provider/model/environment options.",
      ].join("\n");
    case "update":
      return [
        "Usage: agentix update [--check|--install]",
        "",
        "Checks npm for Agentix updates and can install the latest global package.",
        "Use `npm install -g @nerdyy/agentix` or the verified curl installer to upgrade.",
      ].join("\n");
    case "server":
      return [
        "Usage: agentix server",
        "",
        "Starts the backend bridge/API and inbox server.",
        "The server exposes the Agentix runtime, dashboard APIs, scheduler, logs,",
        "memory, healing, support bundle, and event stream endpoints.",
      ].join("\n");
    case "doctor":
      return [
        "Usage: agentix doctor [--json|--full]",
        "",
        "Runs Agentix backend diagnostics for the current workspace.",
      ].join("\n");
    case "status":
      return [
        "Usage: agentix status [--json]",
        "",
        "Shows a concise Agentix backend health summary.",
      ].join("\n");
    case "usage":
      return [
        "Usage: agentix usage",
        "",
        "Prints Agentix backend runtime usage counters.",
      ].join("\n");
    case "config":
      return [
        "Usage: agentix config [show|check|path|set <key> <value>]",
        "",
        "Inspects or updates Agentix workspace backend config.",
      ].join("\n");
    case "sessions":
      return [
        "Usage: agentix sessions [list|create [model]|inspect <id>|rename <id> <title>|delete <id>|prune [days]|optimize]",
        "",
        "Manages Agentix workspace sessions.",
      ].join("\n");
    case "memory":
      return [
        "Usage: agentix memory [status|list [session-id]|search <query>|consolidate [session-id]|reset [all|memory|user] [session-id]]",
        "",
        "Inspects and manages Agentix memory.",
      ].join("\n");
    case "cron":
    case "scheduler":
      return [
        "Usage: agentix cron [list|create|run|pause|resume|delete|history] ...",
        "",
        "Manages Agentix scheduled jobs.",
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
    case "readiness":
      return [
        "Usage: agentix readiness [--json]",
        "",
        "Reports private-beta and public-release readiness gates.",
        "Public release readiness still requires external proof for npm/GitHub publishing and live credentials.",
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
    case "tools":
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
        "Open the Agentix interactive shell from the current folder.",
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

function resolveCompatibilityFrontendRoot() {
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

const COMPAT_FRONTEND_ROOT = resolveCompatibilityFrontendRoot();
const COMPAT_PYTHON_VENV_ROOT = resolve(
  process.env.AGENTIX_PYTHON_VENV || join(os.homedir(), ".agentix", "python-frontend"),
);

function bridgeUrl() {
  if (activeBridgeUrl) {
    return activeBridgeUrl;
  }
  return (
    process.env.AGENTIX_BRIDGE_URL ||
    "http://127.0.0.1:3456"
  );
}

function explicitBridgeUrlConfigured() {
  return Boolean(process.env.AGENTIX_BRIDGE_URL);
}

function portFromBridgeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      return Number(parsed.port);
    }
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return 3456;
  }
}

function urlForPort(port) {
  return `http://127.0.0.1:${port}`;
}

function findFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.unref();
    server.on("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => {
        if (port > 0) {
          resolvePort(port);
        } else {
          rejectPort(new Error("failed to allocate a local bridge port"));
        }
      });
    });
  });
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

function parseFrontendModelConfig(file) {
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
  if (normalized.includes("kilo")) {
    return ["KILOCODE_API_KEY", "KILO_API_KEY", "AGENTIX_LLM_API_KEY", "OPENAI_API_KEY"];
  }
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
  return ["AGENTIX_LLM_API_KEY", "KILOCODE_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"];
}

function buildRuntimeEnv(extra = {}) {
  const frontendEnv = parseEnvFile(join(AGENTIX_FRONTEND_HOME, ".env"));
  const workspaceEnv = parseEnvFile(join(WORKSPACE_ROOT, ".env.local"));
  const modelConfig = parseFrontendModelConfig(join(AGENTIX_FRONTEND_HOME, "config.yaml"));
  const env = {
    ...frontendEnv,
    ...workspaceEnv,
    ...process.env,
    ...extra,
    HERMES_HOME: AGENTIX_FRONTEND_HOME,
    AGENTIX_FRONTEND_HOME,
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
    const providerForKeys = env.AGENTIX_BASE_URL?.includes("api.kilo.ai")
      ? "kilocode"
      : env.AGENTIX_PROVIDER || modelConfig.provider;
    for (const keyName of providerKeyCandidates(providerForKeys)) {
      if (env[keyName]) {
        env.AGENTIX_LLM_API_KEY = env[keyName];
        break;
      }
    }
  }

  return env;
}

function healthCheck(timeoutMs = 2000, url = bridgeUrl()) {
  return new Promise((resolveHealth) => {
    let settled = false;
    const finish = (healthy) => {
      if (settled) {
        return;
      }
      settled = true;
      resolveHealth(healthy);
    };

    const req = http.get(`${url}/health`, { timeout: timeoutMs }, (res) => {
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

async function waitForBridgeHealth(timeoutMs = 10000, url = bridgeUrl()) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthCheck(1000, url)) {
      return true;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  return false;
}

function bridgeControlCheck(timeoutMs = 3000, url = bridgeUrl()) {
  return new Promise((resolveReady) => {
    let settled = false;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      resolveReady(ready);
    };
    const target = new URL("/config", url);
    const req = http.request(target, {
      method: "GET",
      timeout: timeoutMs,
      headers: process.env.AGENTIX_SESSION_TOKEN
        ? { Authorization: `Bearer ${process.env.AGENTIX_SESSION_TOKEN}` }
        : {},
    }, (res) => {
      const ready = res.statusCode === 200;
      res.resume();
      res.on("end", () => finish(ready));
      res.on("error", () => finish(false));
    });
    req.on("error", () => finish(false));
    req.on("timeout", () => {
      req.destroy();
      finish(false);
    });
    req.end();
  });
}

function venvPython() {
  return process.platform === "win32"
    ? resolve(COMPAT_PYTHON_VENV_ROOT, "Scripts", "python.exe")
    : resolve(COMPAT_PYTHON_VENV_ROOT, "bin", "python");
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
    "Python 3 is required for bundled Agentix compatibility commands. Set AGENTIX_PYTHON to a Python 3 executable if auto-detection fails.",
  );
}

function ensureVenv() {
  if (existsSync(venvPython())) {
    return venvPython();
  }

  mkdirSync(COMPAT_PYTHON_VENV_ROOT, { recursive: true });
  const python = resolveSystemPython();
  const created = spawnSync(python.command, [...python.args, "-m", "venv", COMPAT_PYTHON_VENV_ROOT], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });
  if (created.status !== 0) {
    throw new Error("failed to create Agentix compatibility Python virtual environment");
  }
  return venvPython();
}

function ensureFrontendCompatibilityInstalled(pythonExe) {
  const check = spawnSync(pythonExe, ["-c", "import hermes_cli.main"], {
    cwd: COMPAT_FRONTEND_ROOT,
    env: {
      ...process.env,
      PYTHONPATH: COMPAT_FRONTEND_ROOT,
    },
    stdio: "ignore",
  });

  if (check.status === 0) {
    return;
  }

  const installed = spawnSync(pythonExe, ["-m", "pip", "install", "-e", COMPAT_FRONTEND_ROOT], {
    cwd: COMPAT_FRONTEND_ROOT,
    stdio: "inherit",
  });
  if (installed.status !== 0) {
    throw new Error("failed to install Agentix compatibility dependencies");
  }
}

async function ensureBridgeRunning() {
  if ((await healthCheck()) && (await bridgeControlCheck())) {
    return;
  }

  const preferredUrl = bridgeUrl();
  const port = explicitBridgeUrlConfigured()
    ? portFromBridgeUrl(preferredUrl)
    : await findFreePort();
  const url = explicitBridgeUrlConfigured() ? preferredUrl : urlForPort(port);
  activeBridgeUrl = url;

  const child = spawn("node", [resolve(PROJECT_ROOT, "dist", "bridge", "entry.js")], {
    cwd: WORKSPACE_ROOT,
    detached: true,
    stdio: "ignore",
    env: buildRuntimeEnv({
      AGENTIX_BRIDGE_PORT: String(port),
      AGENTIX_BRIDGE_URL: url,
      HERMES_BRIDGE_URL: url,
    }),
  });
  child.unref();

  if (!(await waitForBridgeHealth(10000, url)) || !(await bridgeControlCheck(10000, url))) {
    if (!explicitBridgeUrlConfigured() && url !== preferredUrl) {
      throw new Error(`Agentix bridge failed to start on fallback port ${port}`);
    }
    throw new Error(`Agentix bridge failed to start at ${url}`);
  }
}

async function spawnFrontendCompatibility(args) {
  const pythonExe = ensureVenv();
  ensureFrontendCompatibilityInstalled(pythonExe);

  const child = spawn(pythonExe, ["-m", "hermes_cli.main", ...args], {
    cwd: WORKSPACE_ROOT,
    stdio: "inherit",
    env: buildRuntimeEnv({
      PYTHONPATH: COMPAT_FRONTEND_ROOT,
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

async function spawnNodeShell() {
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
}

function printAgentixOptions(topic = "all") {
  const providers = [
    ["kilocode", "Kilo Gateway OpenAI-compatible endpoint"],
    ["custom", "OpenAI-compatible gateways, including Kilo Gateway"],
    ["openai", "OpenAI API-compatible default endpoint"],
    ["anthropic", "Anthropic Messages API"],
    ["openrouter", "OpenRouter OpenAI-compatible endpoint"],
    ["local", "Local OpenAI-compatible server such as Ollama/vLLM/LM Studio"],
  ];
  const examples = [
    "agentix setup",
    "agentix model",
    "agentix options providers",
    "agentix options env",
    "agentix server",
    "agentix",
  ];

  if (topic === "providers" || topic === "all") {
    console.log("Providers:");
    for (const [name, description] of providers) {
      console.log(`  ${name.padEnd(10)} ${description}`);
    }
    console.log("");
  }
  if (topic === "models" || topic === "all") {
    console.log("Model examples:");
    console.log("  Kilo Gateway: provider kilocode, base URL https://api.kilo.ai/api/gateway, model id from Kilo");
    console.log("  OpenAI:       gpt-4o-mini, gpt-4.1-mini, gpt-5-codex-compatible ids when available");
    console.log("  Anthropic:   claude-3-5-sonnet-latest or your configured model id");
    console.log("  Local:       whatever your local /v1/models endpoint exposes");
    console.log("");
  }
  if (topic === "env" || topic === "all") {
    console.log("Environment variables:");
    console.log("  AGENTIX_PROVIDER=kilocode");
    console.log("  AGENTIX_MODEL=<model-id>");
    console.log("  AGENTIX_BASE_URL=https://api.kilo.ai/api/gateway");
    console.log("  AGENTIX_LLM_API_KEY=<provider-or-gateway-key>");
    console.log("  KILOCODE_API_KEY=<kilo-gateway-key>  # accepted alias");
    console.log("  AGENTIX_BRIDGE_URL=http://127.0.0.1:<port>  # optional explicit bridge");
    console.log("");
  }
  if (topic === "commands" || topic === "all") {
    console.log("Common commands:");
    for (const example of examples) console.log(`  ${example}`);
    console.log("");
  }
  if (!["providers", "models", "env", "commands", "all"].includes(topic)) {
    console.log("Usage: agentix options [providers|models|env|commands]");
  }
}

async function runAgentixUpdate(args = []) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(buildCommandHelp("update"));
    return;
  }
  const installRequested = args.includes("--install") || args.includes("--upgrade");

  const installCommand = () => {
    const userAgent = String(process.env.npm_config_user_agent || "").toLowerCase();
    if (userAgent.includes("pnpm")) return { command: "pnpm", args: ["add", "-g", `${pkg.name}@latest`] };
    if (userAgent.includes("yarn")) return { command: "yarn", args: ["global", "add", `${pkg.name}@latest`] };
    if (userAgent.includes("bun")) return { command: "bun", args: ["add", "-g", `${pkg.name}@latest`] };
    return { command: process.platform === "win32" ? "npm.cmd" : "npm", args: ["install", "-g", `${pkg.name}@latest`] };
  };

  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`;
  let latest = null;
  try {
    const res = await fetch(registryUrl, { headers: { Accept: "application/json" } });
    if (res.status === 404) {
      console.log("Agentix update");
      console.log(`Installed: ${pkg.version}`);
      console.log("Latest:    not published on npm yet");
      console.log("Status:    local/source install");
      console.log("");
      console.log(`Once published: npm install -g ${pkg.name}`);
      return;
    }
    if (!res.ok) {
      throw new Error(`npm registry returned ${res.status}`);
    }
    const metadata = await res.json();
    latest = metadata?.["dist-tags"]?.latest || null;
  } catch (err) {
    console.log("Agentix update check failed.");
    console.log(`Installed: ${pkg.version}`);
    console.log(`Reason: ${err instanceof Error ? err.message : String(err)}`);
    console.log("");
    console.log(`Manual upgrade: npm install -g ${pkg.name}`);
    return;
  }

  console.log("Agentix update");
  console.log(`Installed: ${pkg.version}`);
  console.log(`Latest:    ${latest || "unknown"}`);
  if (!latest || latest === pkg.version) {
    console.log("Status:    up to date");
    return;
  }
  console.log("Status:    update available");
  if (installRequested) {
    const update = installCommand();
    console.log("");
    console.log(`Running: ${update.command} ${update.args.join(" ")}`);
    const child = spawn(update.command, update.args, {
      cwd: WORKSPACE_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32" && update.command.endsWith(".cmd"),
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
    return;
  }
  console.log("");
  console.log("Upgrade:");
  console.log(`  npm install -g ${pkg.name}`);
  console.log("");
  console.log("Verified installer:");
  console.log("  curl -fsSL <release-install-url> | sh");
  console.log("");
  console.log("Auto-install:");
  console.log("  agentix update --install");
}

function writeWorkspaceConfig({ provider, model, baseUrl }) {
  const dataDir = join(WORKSPACE_ROOT, "data");
  mkdirSync(dataDir, { recursive: true });
  const configFile = join(dataDir, "config.json");
  let existing = {};
  if (existsSync(configFile)) {
    try {
      existing = JSON.parse(readFileSync(configFile, "utf8"));
    } catch {
      existing = {};
    }
  }
  const next = {
    ...existing,
    provider,
    model,
    baseUrl: baseUrl || null,
  };
  delete next.llmApiKey;
  delete next.sessionToken;
  writeFileSync(configFile, JSON.stringify(next, null, 2), "utf8");
  return configFile;
}

function writeWorkspaceEnv({ provider, model, baseUrl, apiKey }) {
  const envFile = join(WORKSPACE_ROOT, ".env.local");
  const current = parseEnvFile(envFile);
  const next = {
    ...current,
    AGENTIX_PROVIDER: provider,
    AGENTIX_MODEL: model,
    AGENTIX_BASE_URL: baseUrl,
    AGENTIX_LLM_API_KEY: apiKey,
  };
  const content = Object.entries(next)
    .filter(([, value]) => String(value ?? "").trim() !== "")
    .map(([key, value]) => `${key}=${String(value).replace(/\r?\n/g, "")}`)
    .join("\n") + "\n";
  writeFileSync(envFile, content, "utf8");
  return envFile;
}

async function promptForConfig(section = "all") {
  const pipedAnswers = process.stdin.isTTY
    ? null
    : readFileSync(0, "utf8").split(/\r?\n/);
  let pipedIndex = 0;
  const { createInterface } = await import("node:readline/promises");
  const rl = pipedAnswers
    ? null
    : createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (label, fallback = "") => {
    const suffix = fallback ? ` [${fallback}]` : "";
    if (pipedAnswers) {
      const value = (pipedAnswers[pipedIndex++] || "").trim();
      console.log(`${label}${suffix}: ${value ? "(provided)" : ""}`);
      return value || fallback;
    }
    const value = (await rl.question(`${label}${suffix}: `)).trim();
    return value || fallback;
  };
  const defaultBaseUrl = (provider) => {
    const normalized = String(provider || "").toLowerCase();
    if (normalized === "openai") return "https://api.openai.com/v1";
    if (normalized === "kilocode" || normalized === "kilo") return "https://api.kilo.ai/api/gateway";
    if (normalized === "openrouter") return "https://openrouter.ai/api/v1";
    if (normalized === "local") return "http://127.0.0.1:11434/v1";
    return "";
  };

  try {
    const currentEnv = {
      provider: process.env.AGENTIX_PROVIDER || "kilocode",
      model: process.env.AGENTIX_MODEL || "",
      baseUrl: process.env.AGENTIX_BASE_URL || "",
      apiKey: process.env.AGENTIX_LLM_API_KEY || process.env.KILOCODE_API_KEY || "",
    };
    console.log(`Agentix setup`);
    console.log(`Workspace: ${WORKSPACE_ROOT}`);
    console.log("");

    let provider = currentEnv.provider;
    let model = currentEnv.model;
    let baseUrl = currentEnv.baseUrl;
    let apiKey = currentEnv.apiKey;

    if (section === "all" || section === "model") {
      provider = await ask("Provider (kilocode/custom/openai/anthropic/openrouter/local)", provider);
      model = await ask("Model", model || (["kilocode", "kilo"].includes(provider.toLowerCase()) ? "moonshotai/kimi-k2" : "gpt-4o-mini"));
      baseUrl = await ask("Base URL", baseUrl || defaultBaseUrl(provider));
      apiKey = await ask("API key", apiKey);
    }

    const envFile = writeWorkspaceEnv({ provider, model, baseUrl, apiKey });
    const configFile = writeWorkspaceConfig({ provider, model, baseUrl });
    console.log("");
    console.log(`Saved ${envFile}`);
    console.log(`Synced non-secret defaults to ${configFile}`);
    console.log(`Provider: ${provider}`);
    console.log(`Model: ${model}`);
    console.log(`Base URL: ${baseUrl || "(provider default)"}`);
    console.log(`API key: ${apiKey ? "configured" : "missing"}`);
    console.log("");
    console.log("Next: run `agentix` to open the Agentix shell.");
  } finally {
    rl?.close();
  }
}

async function verifyCurrentModel(args = []) {
  const script = resolve(PROJECT_ROOT, "scripts", "verify-live-llm.mjs");
  const forwarded = args.filter((arg) => arg !== "--verify");
  const child = spawn(process.execPath, [script, ...forwarded], {
    cwd: WORKSPACE_ROOT,
    stdio: "inherit",
    env: buildRuntimeEnv(),
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
    await spawnNodeShell();
    return;
  }

  if (!cmd && process.stdin.isTTY) {
    await spawnNodeShell();
    return;
  }
  if (!cmd) {
    await spawnNodeShell();
    return;
  }

  if (cmd === "setup") {
    if (args.includes("--help") || args.includes("-h")) {
      console.log(buildSetupHelp());
      return;
    }
    if (args[0] === "options") {
      printAgentixOptions(args[1] || "all");
      return;
    }
    await promptForConfig(args[0] === "model" ? "model" : "all");
    return;
  }

  if (cmd === "model") {
    if (args.includes("--help") || args.includes("-h")) {
      console.log([
        "Usage: agentix model [--verify]",
        "",
        "Configures Agentix provider/model/base URL/API key for this workspace.",
        "For Kilo Gateway, use provider `kilocode`, the Kilo model id, and base URL `https://api.kilo.ai/api/gateway`.",
        "Use `agentix model --verify` to run a live provider handshake with the current config.",
      ].join("\n"));
      return;
    }
    if (args.includes("--verify")) {
      await verifyCurrentModel(args);
      return;
    }
    await promptForConfig("model");
    return;
  }

  if (cmd === "options") {
    printAgentixOptions(args[0] || "all");
    return;
  }

  if (cmd === "update") {
    await runAgentixUpdate(args);
    return;
  }

  if (cmd === "version" || cmd === "--version" || cmd === "-V") {
    console.log(`Agentix v${pkg.version}`);
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
    if (FRONTEND_COMPAT_COMMANDS.has(args[0])) {
      if (args[0] === "setup" || args[0] === "model" || args[0] === "options") {
        console.log(buildCommandHelp(args[0]));
        return;
      }
      await spawnFrontendCompatibility([args[0], "--help"]);
      return;
    }
    await spawnFrontendCompatibility(["--help"]);
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    if (BACKEND_COMMANDS.has(cmd) || AGENTIX_COMMAND_HELP.has(cmd)) {
      console.log(buildCommandHelp(cmd));
      return;
    }
    if (FRONTEND_COMPAT_COMMANDS.has(cmd)) {
      if (cmd === "setup" || cmd === "model" || cmd === "options") {
        console.log(buildLauncherHelp());
        return;
      }
      await spawnFrontendCompatibility([cmd, "--help"]);
      return;
    }
  }

  if (cmd && BACKEND_COMMANDS.has(cmd)) {
    await spawnNodeCli([cmd, ...args]);
    return;
  }

  if (cmd && FRONTEND_COMPAT_COMMANDS.has(cmd) && BRIDGELESS_FRONTEND_COMMANDS.has(cmd)) {
    await spawnFrontendCompatibility([cmd, ...args]);
    return;
  }

  await ensureBridgeRunning();
  await spawnFrontendCompatibility(argv.filter(Boolean));
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`agentix ${pkg.version}: ${message}`);
  process.exit(1);
});
