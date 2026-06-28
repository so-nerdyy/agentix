import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
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
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
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

function runFailure(command, args, opts = {}) {
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
      if (code !== 0) {
        resolveRun({ stdout, stderr, code });
        return;
      }
      rejectRun(new Error(`${command} ${args.join(" ")} unexpectedly succeeded`));
    });
  });
}

function sha256(file) {
  const hash = createHash("sha256");
  hash.update(readFileSync(file));
  return hash.digest("hex");
}

function parseNpmPackJson(stdout) {
  const jsonStart = stdout.indexOf("[");
  if (jsonStart === -1) {
    throw new Error(`npm pack did not emit JSON:\n${stdout}`);
  }
  return JSON.parse(stdout.slice(jsonStart));
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
    const server = createNetServer();
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
  const packInfo = parseNpmPackJson(packed.stdout);
  const tarball = join(packDir, packInfo[0].filename);
  assert(existsSync(tarball), `packed tarball missing: ${tarball}`);

  log("installing packed artifact into isolated prefix");
  await run(npm, ["install", "-g", "--prefix", prefixDir, tarball, "--no-audit", "--no-fund"], {
    env: npmEnv,
    timeoutMs: 480_000,
  });
  assert(existsSync(agentixCommand), `installed agentix command missing: ${agentixCommand}`);
  assert(existsSync(agentixEntrypoint), `installed agentix entrypoint missing: ${agentixEntrypoint}`);
  return { tarball, tarballName: packInfo[0].filename, sha256: sha256(tarball) };
}

function smokeInstallScripts() {
  log("checking bootstrap installer scripts");
  const shellInstaller = readFileSync(join(root, "install.sh"), "utf-8");
  assert(shellInstaller.includes("Install Agentix globally with npm."), "install.sh is not the Agentix installer");
  assert(shellInstaller.includes("AGENTIX_PACKAGE"), "install.sh missing AGENTIX_PACKAGE support");
  assert(shellInstaller.includes("AGENTIX_EXPECTED_SHA256"), "install.sh missing checksum support");
  assert(shellInstaller.includes("AGENTIX_VERSION"), "install.sh missing versioned release install support");
  assert(shellInstaller.includes("npm install -g"), "install.sh missing global npm install");
  assert(shellInstaller.includes("agentix setup"), "install.sh missing setup next step");
  assert(!shellInstaller.includes("caveman"), "install.sh contains unrelated plugin installer content");

  const powershellInstaller = readFileSync(join(root, "install.ps1"), "utf-8");
  assert(powershellInstaller.includes("Installing Agentix package"), "install.ps1 is not the Agentix installer");
  assert(powershellInstaller.includes("AGENTIX_EXPECTED_SHA256"), "install.ps1 missing checksum support");
  assert(powershellInstaller.includes("AGENTIX_VERSION"), "install.ps1 missing versioned release install support");
  assert(powershellInstaller.includes("npm install -g"), "install.ps1 missing global npm install");
  assert(powershellInstaller.includes("agentix setup"), "install.ps1 missing setup next step");
}

async function smokeInstallerChecksum(tarball, expectedSha256) {
  log("checking installer checksum enforcement");
  const installerEnv = {
    ...process.env,
    AGENTIX_PACKAGE: tarball,
    AGENTIX_EXPECTED_SHA256: expectedSha256,
    AGENTIX_DRY_RUN: "1",
    AGENTIX_SKIP_SETUP: "1",
  };
  const tampered = join(packDir, "tampered.tgz");
  await copyFile(tarball, tampered);
  await writeFile(tampered, "tampered release artifact\n", "utf-8");
  const badEnv = {
    ...installerEnv,
    AGENTIX_PACKAGE: tampered,
  };

  if (process.platform === "win32") {
    await run("powershell", ["-ExecutionPolicy", "Bypass", "-File", join(root, "install.ps1"), "-DryRun", "-SkipSetup"], {
      env: installerEnv,
      timeoutMs: 60_000,
    });
    const failed = await runFailure("powershell", ["-ExecutionPolicy", "Bypass", "-File", join(root, "install.ps1"), "-DryRun", "-SkipSetup"], {
      env: badEnv,
      timeoutMs: 60_000,
    });
    assert(`${failed.stdout}\n${failed.stderr}`.includes("Checksum mismatch"), "install.ps1 did not fail closed on checksum mismatch");
    return;
  }

  await run("sh", [join(root, "install.sh")], {
    env: installerEnv,
    timeoutMs: 60_000,
  });
  const failed = await runFailure("sh", [join(root, "install.sh")], {
    env: badEnv,
    timeoutMs: 60_000,
  });
  assert(`${failed.stdout}\n${failed.stderr}`.includes("Checksum mismatch"), "install.sh did not fail closed on checksum mismatch");
}

async function smokeVersionedReleaseInstall(tarball, expectedSha256, tarballName) {
  log("checking versioned release installer download");
  const manifestName = `agentix-${packageJson.version}-manifest.json`;
  const manifest = JSON.stringify({
    package: packageJson.name,
    version: packageJson.version,
    tarball: tarballName,
    sha256: expectedSha256,
  });
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = createHttpServer((req, res) => {
    if (req.url === `/${manifestName}`) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(manifest);
      return;
    }
    if (req.url === `/${tarballName}`) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(readFileSync(tarball));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", resolveListen);
  });

  try {
    const releaseEnv = {
      ...process.env,
      AGENTIX_VERSION: packageJson.version,
      AGENTIX_RELEASE_BASE_URL: baseUrl,
      AGENTIX_DRY_RUN: "1",
      AGENTIX_SKIP_SETUP: "1",
    };

    if (process.platform === "win32") {
      const result = await run("powershell", ["-ExecutionPolicy", "Bypass", "-File", join(root, "install.ps1"), "-DryRun", "-SkipSetup"], {
        env: releaseEnv,
        timeoutMs: 60_000,
      });
      assert(result.stdout.includes("Downloading Agentix release manifest"), "install.ps1 did not fetch release manifest");
      assert(result.stdout.includes("Verified SHA256"), "install.ps1 did not verify downloaded release tarball");
      return;
    }

    const result = await run("sh", [join(root, "install.sh")], {
      env: releaseEnv,
      timeoutMs: 60_000,
    });
    assert(result.stdout.includes("Downloading Agentix release manifest"), "install.sh did not fetch release manifest");
    assert(result.stdout.includes("Verified SHA256"), "install.sh did not verify downloaded release tarball");
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

async function installHermesPythonDependencies() {
  log("installing Hermes Python dependencies for direct import checks");
  await run(python, ["-m", "pip", "install", "--disable-pip-version-check", "-e", join(installedPackageRoot, "hermes-agent")], {
    cwd: smokeRoot,
    timeoutMs: 240_000,
  });
}

async function smokeCli() {
  log("checking installed CLI commands");
  const version = await run(agentixCommand, ["version"], { timeoutMs: 30_000 });
  assert(version.stdout.includes("Agentix v"), "agentix version did not print version");

  const help = await run(agentixCommand, ["help"], { timeoutMs: 30_000 });
  assert(help.stdout.includes("open the Hermes-style interactive shell"), "agentix help missing shell launch help");
  assert(help.stdout.includes("server"), "agentix help missing server command");
  assert(help.stdout.includes("tasks, task"), "agentix help missing task commands");
  assert(help.stdout.includes("approvals, approval"), "agentix help missing approval commands");
  assert(help.stdout.includes("readiness"), "agentix help missing readiness command");

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

  const backendEnv = {
    ...process.env,
    AGENTIX_DATA_DIR: supportDataDir,
  };
  const search = await run(agentixCommand, ["--agentix-cli", "search", "release-smoke"], {
    env: backendEnv,
    timeoutMs: 60_000,
  });
  assert(search.stdout.includes("\"query\": \"release-smoke\""), "installed backend search command failed");
  const healing = await run(agentixCommand, ["--agentix-cli", "healing"], {
    env: backendEnv,
    timeoutMs: 60_000,
  });
  assert(healing.stdout.includes("\"failures\""), "installed backend healing command failed");
  const usage = await run(agentixCommand, ["--agentix-cli", "usage"], {
    env: backendEnv,
    timeoutMs: 60_000,
  });
  assert(usage.stdout.includes("\"counts\""), "installed backend usage command failed");
  const readiness = await run(agentixCommand, ["--agentix-cli", "readiness", "--json"], {
    env: backendEnv,
    timeoutMs: 60_000,
  });
  assert(readiness.stdout.includes("\"privateBetaReady\""), "installed backend readiness command failed");
  assert(readiness.stdout.includes("\"release.publish\""), "installed backend readiness command missing external release gate");
  const config = await run(agentixCommand, ["--agentix-cli", "config", "show"], {
    env: backendEnv,
    timeoutMs: 60_000,
  });
  assert(config.stdout.includes("\"provider\""), "installed backend config command failed");
  const authToken = await run(agentixCommand, ["--agentix-cli", "auth", "create", "viewer", "release-smoke"], {
    env: backendEnv,
    timeoutMs: 60_000,
  });
  assert(authToken.stdout.includes("\"token\""), "installed backend auth token create command failed");
  assert(authToken.stdout.includes("\"role\": \"viewer\""), "installed backend auth token role missing");
  const memory = await run(agentixCommand, ["--agentix-cli", "memory", "status"], {
    env: backendEnv,
    timeoutMs: 60_000,
  });
  assert(memory.stdout.includes("\"records\""), "installed backend memory command failed");
  const sessionCreate = await run(agentixCommand, ["--agentix-cli", "sessions", "create", "smoke-model"], {
    env: backendEnv,
    timeoutMs: 60_000,
  });
  assert(sessionCreate.stdout.includes("\"id\""), "installed backend sessions create command failed");
  const cronList = await run(agentixCommand, ["--agentix-cli", "cron", "list"], {
    env: backendEnv,
    timeoutMs: 60_000,
  });
  assert(cronList.stdout !== undefined, "installed backend cron list command failed");
  await run(agentixCommand, ["--agentix-cli", "approvals"], {
    env: backendEnv,
    timeoutMs: 60_000,
  });
}

async function smokeReinstallPreservesWorkspace(tarball) {
  log("checking reinstall preserves workspace state");
  const workspaceDir = join(smokeRoot, "workspace-upgrade");
  const workspaceData = join(workspaceDir, "data");
  const workspaceHermes = join(workspaceDir, ".agentix", "hermes");
  await mkdir(workspaceData, { recursive: true });
  await mkdir(workspaceHermes, { recursive: true });
  await writeFile(join(workspaceData, "config.json"), JSON.stringify({
    provider: "openai",
    model: "preserved-upgrade-model",
    baseUrl: "http://127.0.0.1:5555/v1",
  }, null, 2) + "\n", "utf-8");
  await writeFile(join(workspaceHermes, "config.yaml"), [
    "model:",
    "  provider: openai",
    "  default: preserved-hermes-model",
    "  base_url: http://127.0.0.1:5555/v1",
    "",
  ].join("\n"), "utf-8");

  await run(npm, ["install", "-g", "--prefix", prefixDir, tarball, "--no-audit", "--no-fund"], {
    env: {
      ...process.env,
      npm_config_cache: cacheDir,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
    timeoutMs: 480_000,
  });

  const preserved = JSON.parse(readFileSync(join(workspaceData, "config.json"), "utf-8"));
  assert(preserved.model === "preserved-upgrade-model", "global reinstall mutated workspace model config");
  assert(preserved.provider === "openai", "global reinstall mutated workspace provider config");
  assert(existsSync(join(workspaceHermes, "config.yaml")), "global reinstall removed Hermes workspace config");

  const shown = await run(agentixCommand, ["--agentix-cli", "config", "show"], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      AGENTIX_WORKSPACE_DIR: workspaceDir,
    },
    timeoutMs: 60_000,
  });
  assert(shown.stdout.includes("\"model\": \"preserved-upgrade-model\""), "reinstalled CLI did not read preserved workspace config");
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
    const openapi = await fetchJson(`${inboxUrl}/openapi.json`);
    assert(openapi.openapi === "3.1.0", "inbox OpenAPI contract missing");
    assert(openapi.paths["/execute/stream"], "OpenAPI contract missing execute stream path");

    log("checking installed Hermes Python entrypoints");
    await installHermesPythonDependencies();
    const hermesEnv = {
      ...serverEnv,
      AGENTIX_FRONTEND: "hermes",
      PYTHONPATH: [
        join(installedPackageRoot, "hermes-agent"),
        process.env.PYTHONPATH,
      ].filter(Boolean).join(process.platform === "win32" ? ";" : ":"),
    };

    const syncWorkspace = join(smokeRoot, "workspace-sync");
    const syncData = join(syncWorkspace, "data");
    const syncHermesHome = join(syncWorkspace, ".agentix", "hermes");
    await mkdir(syncData, { recursive: true });
    await mkdir(syncHermesHome, { recursive: true });
    await writeFile(join(syncHermesHome, "config.yaml"), [
      "model:",
      "  provider: openai",
      "  default: release-smoke-model",
      "  base_url: http://127.0.0.1:7777/v1",
      "",
    ].join("\n"), "utf-8");
    await writeFile(join(syncHermesHome, ".env"), "OPENAI_API_KEY=release-smoke-secret\n", "utf-8");
    const syncConfig = await run(python, [
      "-c",
      [
        "import json",
        "from hermes_cli.agentix_commands import sync_agentix_runtime_config",
        "print(json.dumps(sync_agentix_runtime_config(), sort_keys=True))",
      ].join("; "),
    ], {
      cwd: syncWorkspace,
      env: {
        ...hermesEnv,
        HERMES_HOME: syncHermesHome,
        AGENTIX_WORKSPACE_DIR: syncWorkspace,
        AGENTIX_DATA_DIR: syncData,
      },
      timeoutMs: 120_000,
    });
    assert(syncConfig.stdout.includes("\"model\": \"release-smoke-model\""), "Hermes setup/model sync did not report selected model");
    const syncedRuntimeConfig = JSON.parse(readFileSync(join(syncData, "config.json"), "utf-8"));
    assert(syncedRuntimeConfig.model === "release-smoke-model", "Hermes setup/model sync did not persist model");
    assert(syncedRuntimeConfig.provider === "openai", "Hermes setup/model sync did not persist provider");
    assert(syncedRuntimeConfig.baseUrl === "http://127.0.0.1:7777/v1", "Hermes setup/model sync did not persist base URL");
    assert(!("llmApiKey" in syncedRuntimeConfig), "Hermes setup/model sync persisted API secret");

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

    const configSet = await run(agentixCommand, ["config", "set", "provider", "openai"], {
      cwd: smokeRoot,
      env: hermesEnv,
      timeoutMs: 120_000,
    });
    assert(configSet.stdout.includes("Set Agentix config provider=openai"), "installed agentix config set did not route through Agentix backend");
    const configShow = await run(agentixCommand, ["config", "show"], {
      cwd: smokeRoot,
      env: hermesEnv,
      timeoutMs: 120_000,
    });
    assert(configShow.stdout.includes("\"provider\": \"openai\""), "installed agentix config show did not read Agentix backend config");

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

    const gatewayList = await run(agentixCommand, ["gateway", "list"], {
      cwd: smokeRoot,
      env: hermesEnv,
      timeoutMs: 120_000,
    });
    assert(gatewayList.stdout.includes("Platform") && gatewayList.stdout.includes("Messages"), "installed agentix gateway list did not print backend gateway table");
    assert(gatewayList.stdout.includes("webhook"), "installed agentix gateway list missing webhook gateway");

    const gatewayEnable = await run(agentixCommand, ["gateway", "enable", "webhook"], {
      cwd: smokeRoot,
      env: hermesEnv,
      timeoutMs: 120_000,
    });
    assert(gatewayEnable.stdout.includes("Enabled Agentix gateway: webhook"), "installed agentix gateway enable did not route through Agentix backend");

    const gatewayMessage = await run(agentixCommand, ["gateway", "message", "webhook", "release", "smoke", "gateway", "delegation"], {
      cwd: smokeRoot,
      env: hermesEnv,
      timeoutMs: 120_000,
    });
    assert(gatewayMessage.stdout.includes("\"ok\": true"), "installed agentix gateway message did not return ok");
    assert(gatewayMessage.stdout.includes("release smoke gateway delegation"), "installed agentix gateway message did not execute stimulus");

    const memoryReset = await run(python, [
      "-c",
      [
        "from types import SimpleNamespace",
        "from hermes_cli.agentix_commands import handle_memory",
        "args = SimpleNamespace(memory_command='reset', target='all', yes=True)",
        "assert handle_memory(args)",
      ].join("; "),
    ], {
      cwd: smokeRoot,
      env: hermesEnv,
      timeoutMs: 120_000,
    });
    assert(memoryReset.stdout.includes("Removed"), "Hermes memory reset did not route through Agentix backend");

    const execution = await fetchJson(`${inboxUrl}/execute`, {
      method: "POST",
      body: JSON.stringify({ stimulus: "release smoke task" }),
      timeoutMs: 60_000,
    });
    assert(execution.status === "complete", `execute status was ${execution.status}`);
    assert(Array.isArray(execution.taskIds) && execution.taskIds.length > 0, "execute did not return task ids");
    const plansAfterExecute = await fetchJson(`${inboxUrl}/plans`);
    assert(Array.isArray(plansAfterExecute) && plansAfterExecute.length > 0, "plans endpoint did not return execution");
    const planAction = await fetchJson(`${inboxUrl}/plans/${encodeURIComponent(plansAfterExecute[0].id)}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "cancel" }),
      timeoutMs: 60_000,
    });
    assert(planAction.ok === true, "plan cancel-open-tasks action did not succeed");

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

    const createdToken = await fetchJson(`${inboxUrl}/auth/tokens`, {
      method: "POST",
      body: JSON.stringify({ role: "viewer", label: "server smoke viewer" }),
      timeoutMs: 60_000,
    });
    assert(createdToken.ok === true && String(createdToken.token).startsWith("agx_"), "auth token endpoint did not create a workspace token");
  } finally {
    await stopProcess(server);
  }

  assert(!serverOutput.toLowerCase().includes("error:"), `server emitted error output:\n${serverOutput}`);
}

try {
  await removeDirWithRetries(smokeRoot);
  smokeInstallScripts();
  const packedArtifact = await packAndInstall();
  await smokeInstallerChecksum(packedArtifact.tarball, packedArtifact.sha256);
  await smokeVersionedReleaseInstall(packedArtifact.tarball, packedArtifact.sha256, packedArtifact.tarballName);
  await smokeCli();
  await smokeReinstallPreservesWorkspace(packedArtifact.tarball);
  await smokeServer();
  log("release smoke passed");
} finally {
  if (keepArtifacts) {
    log(`kept smoke artifacts at ${smokeRoot}`);
  } else {
    await removeDirWithRetries(smokeRoot);
  }
}
