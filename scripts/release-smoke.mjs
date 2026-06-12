import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), "..");
const smokeRoot = resolve(root, ".smoke", `release-${Date.now()}`);
const cacheDir = join(smokeRoot, "npm-cache");
const packDir = join(smokeRoot, "pack");
const prefixDir = join(smokeRoot, "prefix");
const supportDataDir = join(smokeRoot, "data-support");
const serverDataDir = join(smokeRoot, "data-server");
const keepArtifacts = process.env.AGENTIX_SMOKE_KEEP === "1";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const python = process.platform === "win32" ? "python" : "python3";
const agentixCommand = process.platform === "win32"
  ? join(prefixDir, "agentix.cmd")
  : join(prefixDir, "bin", "agentix");
const installedPackageRoot = process.platform === "win32"
  ? join(prefixDir, "node_modules", "agentix")
  : join(prefixDir, "lib", "node_modules", "agentix");
const agentixEntrypoint = join(installedPackageRoot, "bin", "agentix.js");

function shouldUseShell(command) {
  return process.platform === "win32" && /\.cmd$/i.test(command);
}

function log(message) {
  console.log(`[smoke] ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, opts = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: opts.cwd ?? root,
      env: opts.env ?? process.env,
      shell: shouldUseShell(command),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          child.kill();
          rejectRun(new Error(`${command} ${args.join(" ")} timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      rejectRun(err);
    });
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      rejectRun(new Error([
        `${command} ${args.join(" ")} exited ${code}`,
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join("\n")));
    });
  });
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolveWait) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolveWait(false);
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolveWait(true);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("close", onExit);
      child.off("exit", onExit);
      child.off("error", onExit);
    };

    child.once("close", onExit);
    child.once("exit", onExit);
    child.once("error", onExit);
  });
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  if (await waitForProcessExit(child, 5000)) {
    return;
  }

  child.kill("SIGKILL");
  await waitForProcessExit(child, 5000);
}

async function removeDirWithRetries(dir) {
  const maxAttempts = 12;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? err.code : "";
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(String(code)) || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 300 * attempt));
    }
  }
}

async function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.on("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function fetchText(url, opts = {}) {
  const response = await fetch(url, {
    ...opts,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  });
  const text = await response.text();
  assert(response.ok, `${url} returned ${response.status}: ${text.slice(0, 300)}`);
  return text;
}

async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  return JSON.parse(text);
}

async function waitForJson(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await fetchJson(url, { timeoutMs: 3000 });
    } catch (err) {
      lastError = err;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
  }
  throw new Error(`timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function packAndInstall() {
  await mkdir(packDir, { recursive: true });
  await mkdir(prefixDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });

  const npmEnv = {
    ...process.env,
    npm_config_cache: cacheDir,
    npm_config_audit: "false",
    npm_config_fund: "false",
  };

  log("packing npm artifact");
  const packed = await run(npm, ["pack", "--pack-destination", packDir, "--json"], {
    env: npmEnv,
    timeoutMs: 180_000,
  });
  const packInfo = JSON.parse(packed.stdout);
  const tarball = join(packDir, packInfo[0].filename);
  assert(existsSync(tarball), `packed tarball missing: ${tarball}`);

  log("installing packed artifact into isolated prefix");
  await run(npm, ["install", "-g", "--prefix", prefixDir, tarball, "--no-audit", "--no-fund"], {
    env: npmEnv,
    timeoutMs: 480_000,
  });
  assert(existsSync(agentixCommand), `installed agentix command missing: ${agentixCommand}`);
  assert(existsSync(agentixEntrypoint), `installed agentix entrypoint missing: ${agentixEntrypoint}`);
}

async function smokeCli() {
  log("checking installed CLI commands");
  const version = await run(agentixCommand, ["version"], { timeoutMs: 30_000 });
  assert(version.stdout.includes("Agentix v"), "agentix version did not print version");

  const help = await run(agentixCommand, ["help"], { timeoutMs: 30_000 });
  assert(help.stdout.includes("open the Hermes-style interactive shell"), "agentix help missing shell launch help");
  assert(help.stdout.includes("server"), "agentix help missing server command");

  const workspaceDir = join(smokeRoot, "workspace-cli");
  await mkdir(workspaceDir, { recursive: true });
  const workspaceEnv = { ...process.env };
  delete workspaceEnv.AGENTIX_DATA_DIR;
  delete workspaceEnv.AGENTIX_WORKSPACE_DIR;
  const workspaceSupport = await run(agentixCommand, ["--agentix-cli", "support"], {
    cwd: workspaceDir,
    env: workspaceEnv,
    timeoutMs: 60_000,
  });
  assert(workspaceSupport.stdout.includes("Support bundle:"), "workspace-local support bundle was not created");
  assert(existsSync(join(workspaceDir, "data", "support")), "workspace-local data/support directory missing");

  const support = await run(agentixCommand, ["--agentix-cli", "support"], {
    env: {
      ...process.env,
      AGENTIX_DATA_DIR: supportDataDir,
    },
    timeoutMs: 60_000,
  });
  assert(support.stdout.includes("Support bundle:"), "agentix support did not create a support bundle");
}

async function smokeServer() {
  const inboxPort = await freePort();
  const bridgePort = await freePort();
  const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
  const inboxUrl = `http://127.0.0.1:${inboxPort}`;
  const serverEnv = {
    ...process.env,
    AGENTIX_SESSION_TOKEN: "",
    AGENTIX_DATA_DIR: serverDataDir,
    AGENTIX_BRIDGE_PORT: String(bridgePort),
    AGENTIX_INBOX_PORT: String(inboxPort),
    AGENTIX_BRIDGE_URL: bridgeUrl,
    HERMES_BRIDGE_URL: bridgeUrl,
  };

  log(`starting installed server on inbox ${inboxPort}, bridge ${bridgePort}`);
  const server = spawn(process.execPath, [
    agentixEntrypoint,
    "--agentix-cli",
    "server",
    "--port",
    String(inboxPort),
    "--bridge-port",
    String(bridgePort),
    "--host",
    "127.0.0.1",
  ], {
    cwd: smokeRoot,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString("utf-8");
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString("utf-8");
  });

  try {
    const inboxHealth = await waitForJson(`${inboxUrl}/health`);
    assert(inboxHealth.status === "ok", "inbox health did not return ok");

    const bridgeHealth = await waitForJson(`${bridgeUrl}/health`);
    assert(bridgeHealth.status === "ok", "bridge health did not return ok");

    const ui = await fetchText(`${inboxUrl}/ui/`);
    assert(ui.includes("Agentix Control"), "dashboard HTML missing Agentix Control");
    assert(ui.includes("Command palette"), "dashboard HTML missing command palette");

    log("checking installed Hermes Python entrypoints");
    const hermesEnv = {
      ...serverEnv,
      AGENTIX_FRONTEND: "hermes",
      PYTHONPATH: [
        join(installedPackageRoot, "hermes-agent"),
        process.env.PYTHONPATH,
      ].filter(Boolean).join(process.platform === "win32" ? ";" : ":"),
    };
    const installedOneshotPrompt = "release smoke installed oneshot delegation";
    const installedOneshot = await run(agentixCommand, [
      "-z",
      process.platform === "win32" ? `"${installedOneshotPrompt}"` : installedOneshotPrompt,
    ], {
      cwd: smokeRoot,
      env: hermesEnv,
      timeoutMs: 120_000,
    });
    assert(installedOneshot.stdout.includes("Agentix is running with the Hermes frontend and Agentix backend."), "installed agentix -z did not route through Agentix backend");
    assert(installedOneshot.stdout.includes(`Input: ${installedOneshotPrompt}`), "installed agentix -z output did not preserve input");

    const installedUsage = await run(agentixCommand, ["usage"], {
      cwd: smokeRoot,
      env: hermesEnv,
      timeoutMs: 120_000,
    });
    assert(installedUsage.stdout.includes("Agentix backend usage"), "installed agentix usage did not route through Agentix backend");

    const oneshot = await run(python, [
      "-c",
      "from hermes_cli.oneshot import run_oneshot; raise SystemExit(run_oneshot('release smoke oneshot delegation'))",
    ], {
      cwd: smokeRoot,
      env: hermesEnv,
      timeoutMs: 120_000,
    });
    assert(oneshot.stdout.includes("Agentix is running with the Hermes frontend and Agentix backend."), "oneshot did not route through Agentix backend");
    assert(oneshot.stdout.includes("Input: release smoke oneshot delegation"), "oneshot output did not preserve streamed content");

    const tuiProxy = await run(python, [
      "-c",
      "from tui_gateway.server import _AgentixTuiProxy; p=_AgentixTuiProxy('release-smoke-session'); r=p.run_conversation('release smoke tui proxy delegation'); print(r['final_response'])",
    ], {
      cwd: smokeRoot,
      env: hermesEnv,
      timeoutMs: 120_000,
    });
    const tuiProxyOutput = `${tuiProxy.stdout}\n${tuiProxy.stderr}`;
    assert(tuiProxyOutput.includes("Agentix is running with the Hermes frontend and Agentix backend."), "TUI proxy did not route through Agentix backend");
    assert(tuiProxyOutput.includes("Input: release smoke tui proxy delegation"), "TUI proxy output did not preserve streamed content");

    const cronAdapter = await run(python, [
      "-c",
      [
        "from types import SimpleNamespace",
        "from hermes_cli.agentix_commands import handle_cron",
        "create = SimpleNamespace(cron_command='create', schedule='every 1m', prompt='release smoke cron delegation', name='release smoke cli cron', script=None, no_agent=False, workdir=None, skills=None)",
        "listing = SimpleNamespace(cron_command='list', all=True)",
        "assert handle_cron(create)",
        "assert handle_cron(listing)",
      ].join("; "),
    ], {
      cwd: smokeRoot,
      env: hermesEnv,
      timeoutMs: 120_000,
    });
    assert(cronAdapter.stdout.includes("Created Agentix scheduled job"), "Hermes cron adapter did not create an Agentix scheduler job");
    assert(cronAdapter.stdout.includes("release smoke cli cron"), "Hermes cron adapter list did not include created job");

    const execution = await fetchJson(`${inboxUrl}/execute`, {
      method: "POST",
      body: JSON.stringify({ stimulus: "release smoke task" }),
      timeoutMs: 60_000,
    });
    assert(execution.status === "complete", `execute status was ${execution.status}`);
    assert(Array.isArray(execution.taskIds) && execution.taskIds.length > 0, "execute did not return task ids");

    const streamed = await fetchText(`${inboxUrl}/execute/stream`, {
      method: "POST",
      body: JSON.stringify({ stimulus: "release smoke streamed task" }),
      timeoutMs: 60_000,
    });
    assert(streamed.includes("data: [DONE]"), "dashboard execute stream did not complete");

    const tasks = await fetchJson(`${inboxUrl}/tasks`);
    assert(Array.isArray(tasks) && tasks.length > 0, "tasks endpoint did not return created task");

    const job = await fetchJson(`${inboxUrl}/scheduler/jobs`, {
      method: "POST",
      body: JSON.stringify({
        name: "release smoke job",
        stimulus: "release scheduled smoke",
        schedule: "every 1m",
        enabled: true,
      }),
      timeoutMs: 60_000,
    });
    assert(job.id, "scheduler job create did not return an id");

    const jobRun = await fetchJson(`${inboxUrl}/scheduler/jobs/${encodeURIComponent(job.id)}/run`, {
      method: "POST",
      body: "{}",
      timeoutMs: 60_000,
    });
    assert(jobRun.ok === true, "scheduler manual run did not succeed");

    const support = await fetchJson(`${inboxUrl}/support/bundle`, {
      method: "POST",
      body: "{}",
      timeoutMs: 60_000,
    });
    assert(support.ok === true, "support bundle endpoint did not succeed");
    assert(Array.isArray(support.files) && support.files.includes("manifest.json"), "support bundle manifest missing");
  } finally {
    await stopProcess(server);
  }

  assert(!serverOutput.toLowerCase().includes("error:"), `server emitted error output:\n${serverOutput}`);
}

try {
  await removeDirWithRetries(smokeRoot);
  await packAndInstall();
  await smokeCli();
  await smokeServer();
  log("release smoke passed");
} finally {
  if (keepArtifacts) {
    log(`kept smoke artifacts at ${smokeRoot}`);
  } else {
    await removeDirWithRetries(smokeRoot);
  }
}
