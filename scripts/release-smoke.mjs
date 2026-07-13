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
const releaseArtifactBase = packageJson.name.replace(/^@/, "").replace(/[\/\\]/g, "-");
const agentixCommand = process.platform === "win32"
  ? join(prefixDir, "agentix.cmd")
  : join(prefixDir, "bin", "agentix");
const packagePathParts = packageJson.name.split("/");
const installedPackageRoot = process.platform === "win32"
  ? join(prefixDir, "node_modules", ...packagePathParts)
  : join(prefixDir, "lib", "node_modules", ...packagePathParts);
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
      stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const startedAt = Date.now();
    let firstOutputMs = null;
    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          child.kill();
          rejectRun(new Error(`${command} ${args.join(" ")} timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      if (firstOutputMs === null) firstOutputMs = Date.now() - startedAt;
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      if (firstOutputMs === null) firstOutputMs = Date.now() - startedAt;
      stderr += chunk.toString("utf-8");
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    child.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      rejectRun(err);
    });
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) {
        resolveRun({ stdout, stderr, firstOutputMs });
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
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(String(code))) {
        throw err;
      }
      if (attempt === maxAttempts) {
        log(`warning: could not remove busy smoke directory ${dir}; leaving it for OS cleanup`);
        return;
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

async function fetchJsonResponse(url, opts = {}) {
  const response = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, body: JSON.parse(text), text };
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

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolveWait, rejectWait) => {
    const timeout = setTimeout(() => rejectWait(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout);
        resolveWait(value);
      },
      (error) => {
        clearTimeout(timeout);
        rejectWait(error);
      },
    );
  });
}

async function eventually(factory, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await factory();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`${message}${lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ""}`);
}

async function smokeActiveShellInterruption({ env, bridgeUrl, providerStarted, providerWasAborted }) {
  log("checking Ctrl+C cancellation through installed shell, Symphony, and Pi");
  const beforeTasks = await fetchJson(`${bridgeUrl}/tasks`);
  const beforeTaskIds = new Set(beforeTasks.map((task) => task.id));
  const marker = "AGENTIX_INTERRUPT_SMOKE";
  const child = spawn(process.execPath, [agentixEntrypoint], {
    cwd: smokeRoot,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  const closed = new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf-8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf-8"); });

  try {
    await eventually(() => stdout.includes("agentix>"), 30_000, "installed shell did not render a prompt");
    child.stdin.write(`${marker}\n`);
    await withTimeout(providerStarted, 30_000, "interrupt fixture provider request did not start");
    child.stdin.write("\x03");
    await eventually(
      () => stdout.includes("Cancelled active task."),
      30_000,
      "installed shell did not acknowledge Ctrl+C cancellation",
    );

    const cancelledTask = await eventually(async () => {
      const tasks = await fetchJson(`${bridgeUrl}/tasks`);
      return tasks.find((task) => !beforeTaskIds.has(task.id) && task.status === "cancelled");
    }, 30_000, "interrupted shell task was not persisted as cancelled");
    const plans = await fetchJson(`${bridgeUrl}/plans`);
    const cancelledPlan = plans.find((plan) => plan.id === cancelledTask.planId);
    assert(cancelledPlan?.status === "cancelled", "interrupted Symphony plan was not persisted as cancelled");
    await eventually(providerWasAborted, 10_000, "interrupted provider request remained active");

    child.stdin.end("/tasks\n/exit\n");
    const exit = await withTimeout(closed, 30_000, "installed shell did not exit after cancellation");
    assert(exit.code === 0, `installed shell exited ${exit.code ?? exit.signal} after cancellation`);
    assert(stdout.includes("[cancelled]"), "installed shell task list did not expose cancelled lifecycle state");
    assert(!/\x1b\[/.test(`${stdout}\n${stderr}`), "interrupted noninteractive shell leaked ANSI control sequences");
    assert(!stderr.trim(), `installed shell emitted interruption errors: ${stderr}`);
  } finally {
    await stopProcess(child);
  }
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
  assert(shellInstaller.includes("Node.js 20+"), "install.sh does not enforce the supported Node.js floor");
  assert(!shellInstaller.includes("caveman"), "install.sh contains unrelated plugin installer content");

  const powershellInstaller = readFileSync(join(root, "install.ps1"), "utf-8");
  assert(powershellInstaller.includes("Installing Agentix package"), "install.ps1 is not the Agentix installer");
  assert(powershellInstaller.includes("AGENTIX_EXPECTED_SHA256"), "install.ps1 missing checksum support");
  assert(powershellInstaller.includes("AGENTIX_VERSION"), "install.ps1 missing versioned release install support");
  assert(powershellInstaller.includes("npm install -g"), "install.ps1 missing global npm install");
  assert(powershellInstaller.includes("agentix setup"), "install.ps1 missing setup next step");
  assert(powershellInstaller.includes("Node.js 20+"), "install.ps1 does not enforce the supported Node.js floor");
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
  const manifestName = `${releaseArtifactBase}-${packageJson.version}-manifest.json`;
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
    const releaseProof = join(packDir, "public-release-proof.json");

    const verified = await run(process.execPath, [
      join(root, "scripts", "verify-public-release.mjs"),
      "--skip-npm",
      "--skip-npm-install",
      "--version",
      packageJson.version,
      "--release-base-url",
      baseUrl,
      "--out",
      releaseProof,
    ], {
      env: releaseEnv,
      timeoutMs: 120_000,
    });
    assert(verified.stdout.includes("\"ok\": true"), "release verifier did not pass against local release fixture");
    assert(verified.stdout.includes(`"sha256": "${expectedSha256}"`), "release verifier did not validate tarball SHA256");
    assert(JSON.parse(readFileSync(releaseProof, "utf-8")).ok === true, "release verifier did not write proof file");

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

async function installCompatibilityPythonDependencies() {
  log("installing compatibility Python dependencies for direct import checks");
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
  assert(help.stdout.includes("open the Agentix interactive shell"), "agentix help missing shell launch help");
  assert(help.stdout.includes("server"), "agentix help missing server command");
  assert(help.stdout.includes("tasks, task"), "agentix help missing task commands");
  assert(help.stdout.includes("approvals, approval"), "agentix help missing approval commands");
  assert(help.stdout.includes("readiness"), "agentix help missing readiness command");
  assert(!help.stdout.includes("Nous"), "agentix help still mentions Nous branding");
  assert(!help.stdout.includes("Portal"), "agentix help still mentions Portal branding");

  const options = await run(agentixCommand, ["options"], { timeoutMs: 30_000 });
  assert(options.stdout.includes("Kilo Gateway"), "agentix options missing Kilo Gateway setup guidance");
  assert(options.stdout.includes("kilocode"), "agentix options missing first-class kilocode provider");
  assert(options.stdout.includes("https://api.kilo.ai/api/gateway"), "agentix options missing Kilo Gateway base URL");
  assert(options.stdout.includes("AGENTIX_LLM_API_KEY"), "agentix options missing Agentix API key env var");
  assert(options.stdout.includes("KILOCODE_API_KEY"), "agentix options missing Kilo Gateway API key alias");
  assert(options.stdout.includes("KILO_API_KEY"), "agentix options missing short Kilo Gateway API key alias");
  assert(!options.stdout.includes("Nous"), "agentix options still mentions Nous branding");

  const updateHelp = await run(agentixCommand, ["update", "--help"], { timeoutMs: 30_000 });
  assert(updateHelp.stdout.includes("Usage: agentix update"), "agentix update help missing usage");
  assert(updateHelp.stdout.includes("--install"), "agentix update help missing auto-install option");
  assert(updateHelp.stdout.includes("npm install -g"), "agentix update help missing npm upgrade path");

  const updateCheck = await run(agentixCommand, ["update", "--check"], { timeoutMs: 60_000 });
  assert(updateCheck.stdout.includes("Agentix update"), "agentix update --check missing Agentix header");
  assert(!updateCheck.stdout.includes("Hermes"), "agentix update --check still mentions Hermes");

  const modelHelp = await run(agentixCommand, ["model", "--help"], { timeoutMs: 30_000 });
  assert(modelHelp.stdout.includes("agentix model [--verify|--list]"), "agentix model help missing verify/list options");
  assert(modelHelp.stdout.includes("https://api.kilo.ai/api/gateway"), "agentix model help missing Kilo Gateway base URL");

  const modelOptions = await run(agentixCommand, ["options", "models"], { timeoutMs: 30_000 });
  assert(modelOptions.stdout.includes("agentix options models --live"), "agentix model options missing live catalog guidance");

  const fortune = await run(agentixCommand, ["fortune"], { timeoutMs: 30_000 });
  assert(fortune.stdout.includes("Powerhouse plans, Symphony schedules, Pi agents execute"), "agentix fortune missing architecture summary");
  assert(!/hermes|nous portal/i.test(fortune.stdout), "agentix fortune leaked compatibility branding");

  const skillsHelp = await run(agentixCommand, ["skills", "reset", "--help"], { timeoutMs: 60_000 });
  assert(skillsHelp.stdout.includes("usage: agentix skills reset"), "installed nested skills help was not preserved");
  assert(!/hermes|nous portal/i.test(skillsHelp.stdout), "installed skills help leaked compatibility branding");

  const pluginsHelp = await run(agentixCommand, ["plugins", "install", "--help"], { timeoutMs: 60_000 });
  assert(pluginsHelp.stdout.includes("usage: agentix plugins install"), "installed nested plugins help was not preserved");
  assert(!/hermes|nous portal/i.test(pluginsHelp.stdout), "installed plugins help leaked compatibility branding");

  const insightsHelp = await run(agentixCommand, ["insights", "--help"], { timeoutMs: 60_000 });
  assert(insightsHelp.stdout.includes("usage: agentix insights"), "installed insights help was not Agentix-branded");
  assert(!/hermes|nous portal/i.test(insightsHelp.stdout), "installed insights help leaked compatibility branding");

  const invalid = await runFailure(agentixCommand, ["run", "--invalid-flag"], { timeoutMs: 60_000 });
  assert(invalid.code === 2, `invalid installed command exited ${invalid.code} instead of usage status 2`);
  assert(invalid.stderr.includes("Unknown Agentix command: run"), "invalid installed command did not identify the unsupported command");
  assert(!/hermes|nous|portal|claw/i.test(`${invalid.stdout}\n${invalid.stderr}`), "invalid installed command leaked compatibility command branding");

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
  const boundedSessions = await run(agentixCommand, ["sessions", "list", "--limit", "1"], {
    env: backendEnv,
    timeoutMs: 60_000,
  });
  assert(boundedSessions.stdout.includes("Showing 1 session(s). Use --all for full list."), "installed sessions list did not stay bounded by default");
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

async function smokeColdShell() {
  log("checking first-command interactive shell cold start");
  const workspaceDir = join(smokeRoot, "workspace-cold-shell");
  await mkdir(workspaceDir, { recursive: true });
  const env = { ...process.env };
  delete env.AGENTIX_BRIDGE_URL;
  delete env.AGENTIX_DATA_DIR;
  delete env.AGENTIX_WORKSPACE_DIR;
  delete env.AGENTIX_SESSION_TOKEN;

  const shell = await run(agentixCommand, [], {
    cwd: workspaceDir,
    env,
    input: "/exit\n",
    timeoutMs: 60_000,
  });
  assert(shell.stdout.includes(`Agentix v${packageJson.version}`), "cold shell did not print the installed version");
  assert(shell.stdout.includes("Starting Agentix"), "cold shell did not provide immediate startup feedback");
  assert(shell.firstOutputMs !== null && shell.firstOutputMs <= 500, `cold shell stayed silent for ${shell.firstOutputMs}ms`);
  assert(shell.stdout.includes("Powerhouse orchestrates. Symphony plans. Pi agents execute."), "cold shell missing architecture banner");
  assert(/Session: sess-[a-z0-9-]+/i.test(shell.stdout), "cold shell did not create a real backend session");
  assert(shell.stdout.includes("agentix>"), "cold shell did not render a prompt");
  assert(!/\x1b\[/.test(`${shell.stdout}\n${shell.stderr}`), "cold noninteractive shell leaked ANSI control sequences");
  assert(!/bridge failed to start/i.test(`${shell.stdout}\n${shell.stderr}`), "cold shell bridge startup failed");
}

async function smokeReinstallPreservesWorkspace(tarball) {
  log("checking reinstall preserves workspace state");
  const workspaceDir = join(smokeRoot, "workspace-upgrade");
  const workspaceData = join(workspaceDir, "data");
  const workspaceFrontend = join(workspaceDir, ".agentix", "frontend");
  await mkdir(workspaceData, { recursive: true });
  await mkdir(workspaceFrontend, { recursive: true });
  await writeFile(join(workspaceData, "config.json"), JSON.stringify({
    provider: "openai",
    model: "preserved-upgrade-model",
    baseUrl: "http://127.0.0.1:5555/v1",
  }, null, 2) + "\n", "utf-8");
  await writeFile(join(workspaceFrontend, "config.yaml"), [
    "model:",
    "  provider: openai",
    "  default: preserved-frontend-model",
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
  assert(existsSync(join(workspaceFrontend, "config.yaml")), "global reinstall removed Agentix frontend workspace config");

  const preservedEnv = {
    ...process.env,
    AGENTIX_WORKSPACE_DIR: workspaceDir,
  };
  for (const key of [
    "AGENTIX_PROVIDER",
    "AGENTIX_MODEL",
    "AGENTIX_BASE_URL",
    "AGENTIX_LLM_API_KEY",
    "AGENTIX_LUNA_MODEL",
    "AGENTIX_TERRA_MODEL",
  ]) {
    delete preservedEnv[key];
  }
  const shown = await run(agentixCommand, ["--agentix-cli", "config", "show"], {
    cwd: workspaceDir,
    env: preservedEnv,
    timeoutMs: 60_000,
  });
  assert(
    shown.stdout.includes("\"model\": \"preserved-frontend-model\""),
    "reinstalled CLI did not apply the preserved frontend model as the effective workspace override",
  );
}

async function smokeServer() {
  const inboxPort = await freePort();
  const bridgePort = await freePort();
  const llmPort = await freePort();
  const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
  const inboxUrl = `http://127.0.0.1:${inboxPort}`;
  const llmBaseUrl = `http://127.0.0.1:${llmPort}/v1`;
  let resolveInterruptedProviderRequest;
  const interruptedProviderRequestStarted = new Promise((resolve) => {
    resolveInterruptedProviderRequest = resolve;
  });
  let interruptedProviderRequestAborted = false;
  const llmServer = createHttpServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf-8");
    });
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid json" }));
        return;
      }
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const system = String(messages.find((message) => message?.role === "system")?.content ?? "");
      const user = String(messages.findLast((message) => message?.role === "user")?.content ?? "");
      if (!system.includes("Agentix Symphony planner") && user.includes("AGENTIX_INTERRUPT_SMOKE")) {
        resolveInterruptedProviderRequest();
        const markAborted = () => { interruptedProviderRequestAborted = true; };
        req.once("aborted", markAborted);
        res.once("close", () => {
          if (!res.writableEnded) markAborted();
        });
        return;
      }
      const content = system.includes("Agentix Symphony planner")
        ? "release fixture intentionally uses static planning"
        : "Agentix fixture response: " + user;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    llmServer.once("error", rejectListen);
    llmServer.listen(llmPort, "127.0.0.1", resolveListen);
  });
  await mkdir(serverDataDir, { recursive: true });
  await writeFile(join(serverDataDir, "config.json"), JSON.stringify({
    provider: "local",
    model: "release-smoke-model",
    baseUrl: llmBaseUrl,
  }, null, 2) + "\n", "utf-8");
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

    await smokeActiveShellInterruption({
      env: serverEnv,
      bridgeUrl,
      providerStarted: interruptedProviderRequestStarted,
      providerWasAborted: () => interruptedProviderRequestAborted,
    });
    const resumedShell = await run(agentixCommand, [], {
      cwd: smokeRoot,
      env: serverEnv,
      input: "/history\n/exit\n",
      timeoutMs: 60_000,
    });
    assert(
      resumedShell.stdout.includes("AGENTIX_INTERRUPT_SMOKE"),
      "installed shell restart did not restore persisted session history",
    );
    assert(
      resumedShell.stdout.includes("Agentix execution cancelled"),
      "installed shell history omitted the persisted cancellation response",
    );

    const ui = await fetchText(`${inboxUrl}/ui/`);
    assert(ui.includes("Agentix Control"), "dashboard HTML missing Agentix Control");
    assert(ui.includes("Command palette"), "dashboard HTML missing command palette");
    assert(!ui.includes("Hermes frontend"), "dashboard HTML exposes Hermes frontend branding");
    assert(!ui.includes("Nous"), "dashboard HTML exposes Nous branding");
    assert(!ui.includes("Portal"), "dashboard HTML exposes Portal branding");
    const dashboardCss = await fetchText(`${inboxUrl}/ui/styles.css`);
    assert(
      dashboardCss.includes(".palette-backdrop[hidden]") && dashboardCss.includes("display: none"),
      "dashboard command palette can block the control surface while hidden",
    );
    const dashboardApp = await fetchText(`${inboxUrl}/ui/app.js`);
    assert(
      dashboardApp.includes("refs.sessionSelect.value") && !dashboardApp.includes("state.sessionSelect.value"),
      "dashboard Compose form cannot read the selected session",
    );
    assert(
      dashboardApp.includes("opts.body !== undefined") && !dashboardApp.includes('const headers = { "Content-Type": "application/json"'),
      "dashboard sends an invalid empty JSON body for bodyless POST actions",
    );
    assert(
      dashboardApp.includes('["queued", "running", "awaiting-approval"].includes(task.status)'),
      "dashboard counts terminal rejected or cancelled tasks as open",
    );
    assert(
      !dashboardApp.includes("event.currentTarget.reset()"),
      "dashboard async form handlers lose their form target after a successful request",
    );
    assert(
      dashboardApp.includes("!visibleApprovals.some") && dashboardApp.includes("state.approvalDetail = null"),
      "dashboard keeps stale approval details after a decision",
    );
    const openapi = await fetchJson(`${inboxUrl}/openapi.json`);
    assert(openapi.openapi === "3.1.0", "inbox OpenAPI contract missing");
    assert(openapi.paths["/execute/stream"], "OpenAPI contract missing execute stream path");

    log("checking installed Agentix compatibility Python entrypoints");
    await installCompatibilityPythonDependencies();
    const compatibilityEnv = {
      ...serverEnv,
      AGENTIX_FRONTEND: "hermes",
      PYTHONPATH: [
        join(installedPackageRoot, "hermes-agent"),
        process.env.PYTHONPATH,
      ].filter(Boolean).join(process.platform === "win32" ? ";" : ":"),
    };

    const syncWorkspace = join(smokeRoot, "workspace-sync");
    const syncData = join(syncWorkspace, "data");
    const syncFrontendHome = join(syncWorkspace, ".agentix", "frontend");
    await mkdir(syncData, { recursive: true });
    await mkdir(syncFrontendHome, { recursive: true });
    await writeFile(join(syncFrontendHome, "config.yaml"), [
      "model:",
      "  provider: openai",
      "  default: release-smoke-model",
      "  base_url: http://127.0.0.1:7777/v1",
      "",
    ].join("\n"), "utf-8");
    await writeFile(join(syncFrontendHome, ".env"), "OPENAI_API_KEY=release-smoke-secret\n", "utf-8");
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
        ...compatibilityEnv,
        AGENTIX_FRONTEND_HOME: syncFrontendHome,
        AGENTIX_WORKSPACE_DIR: syncWorkspace,
        AGENTIX_DATA_DIR: syncData,
      },
      timeoutMs: 120_000,
    });
    assert(syncConfig.stdout.includes("\"model\": \"release-smoke-model\""), "Agentix setup/model compatibility sync did not report selected model");
    const syncedRuntimeConfig = JSON.parse(readFileSync(join(syncData, "config.json"), "utf-8"));
    assert(syncedRuntimeConfig.model === "release-smoke-model", "Agentix setup/model compatibility sync did not persist model");
    assert(syncedRuntimeConfig.provider === "openai", "Agentix setup/model compatibility sync did not persist provider");
    assert(syncedRuntimeConfig.baseUrl === "http://127.0.0.1:7777/v1", "Agentix setup/model compatibility sync did not persist base URL");
    assert(!("llmApiKey" in syncedRuntimeConfig), "Agentix setup/model compatibility sync persisted API secret");

    const installedOneshotPrompt = "release smoke installed oneshot delegation";
    const installedOneshot = await run(agentixCommand, [
      "-z",
      process.platform === "win32" ? `"${installedOneshotPrompt}"` : installedOneshotPrompt,
    ], {
      cwd: smokeRoot,
      env: compatibilityEnv,
      timeoutMs: 120_000,
    });
    assert(installedOneshot.stdout.includes("Agentix fixture response:"), "installed agentix -z did not call the configured model fixture");
    assert(installedOneshot.stdout.includes(installedOneshotPrompt), "installed agentix -z output did not preserve input");

    const selectorOneshot = await run(agentixCommand, [
      "-z",
      "release-smoke-selector-delegation",
      "--model",
      "release-selector-model",
      "--provider",
      "local",
      "--toolsets",
      "web",
    ], {
      cwd: smokeRoot,
      env: compatibilityEnv,
      timeoutMs: 120_000,
    });
    assert(selectorOneshot.stdout.includes("release-smoke-selector-delegation"), "installed agentix -z selector run did not preserve input");
    const selectorSessions = await fetchJson(`${bridgeUrl}/sessions?all=1`, { timeoutMs: 60_000 });
    assert(
      Array.isArray(selectorSessions) && selectorSessions.some((session) =>
        session?.metadata?.model === "release-selector-model"
        && session?.metadata?.provider === "local"
        && String(session?.metadata?.toolsets ?? "").includes("web"),
      ),
      "installed agentix -z did not persist selector metadata through Agentix backend",
    );

    const installedUsage = await run(agentixCommand, ["usage"], {
      cwd: smokeRoot,
      env: compatibilityEnv,
      timeoutMs: 120_000,
    });
    assert(installedUsage.stdout.includes("Agentix backend usage"), "installed agentix usage did not route through Agentix backend");

    const configSet = await run(agentixCommand, ["config", "set", "provider", "local"], {
      cwd: smokeRoot,
      env: compatibilityEnv,
      timeoutMs: 120_000,
    });
    const configSetResult = JSON.parse(configSet.stdout);
    assert(
      configSetResult.ok === true && configSetResult.key === "provider" && configSetResult.value === "local",
      "installed agentix config set did not route through Agentix backend",
    );
    const configShow = await run(agentixCommand, ["config", "show"], {
      cwd: smokeRoot,
      env: compatibilityEnv,
      timeoutMs: 120_000,
    });
    assert(configShow.stdout.includes("\"provider\": \"local\""), "installed agentix config show did not read Agentix backend config");

    const oneshot = await run(python, [
      "-c",
      "from hermes_cli.oneshot import run_oneshot; raise SystemExit(run_oneshot('release smoke oneshot delegation'))",
    ], {
      cwd: smokeRoot,
      env: compatibilityEnv,
      timeoutMs: 120_000,
    });
    assert(oneshot.stdout.includes("Agentix fixture response:"), "oneshot did not call the configured model fixture");
    assert(oneshot.stdout.includes("release smoke oneshot delegation"), "oneshot output did not preserve streamed content");

    const tuiProxy = await run(python, [
      "-c",
      "from tui_gateway.server import _AgentixTuiProxy; p=_AgentixTuiProxy('release-smoke-session'); r=p.run_conversation('release smoke tui proxy delegation'); print(r['final_response'])",
    ], {
      cwd: smokeRoot,
      env: compatibilityEnv,
      timeoutMs: 120_000,
    });
    const tuiProxyOutput = `${tuiProxy.stdout}\n${tuiProxy.stderr}`;
    assert(tuiProxyOutput.includes("Agentix fixture response:"), "TUI proxy did not call the configured model fixture");
    assert(tuiProxyOutput.includes("release smoke tui proxy delegation"), "TUI proxy output did not preserve streamed content");

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
      env: compatibilityEnv,
      timeoutMs: 120_000,
    });
    assert(cronAdapter.stdout.includes("Created Agentix scheduled job"), "Agentix cron compatibility adapter did not create an Agentix scheduler job");
    assert(cronAdapter.stdout.includes("release smoke cli cron"), "Agentix cron compatibility adapter list did not include created job");

    const gatewayList = await run(agentixCommand, ["gateway", "list"], {
      cwd: smokeRoot,
      env: compatibilityEnv,
      timeoutMs: 120_000,
    });
    assert(gatewayList.stdout.includes("Platform") && gatewayList.stdout.includes("Messages"), "installed agentix gateway list did not print backend gateway table");
    assert(gatewayList.stdout.includes("webhook"), "installed agentix gateway list missing webhook gateway");

    const gatewayEnable = await run(agentixCommand, ["gateway", "enable", "webhook"], {
      cwd: smokeRoot,
      env: compatibilityEnv,
      timeoutMs: 120_000,
    });
    assert(gatewayEnable.stdout.includes("Enabled Agentix gateway: webhook"), "installed agentix gateway enable did not route through Agentix backend");

    const gatewayMessage = await run(agentixCommand, ["gateway", "message", "webhook", "release", "smoke", "gateway", "delegation"], {
      cwd: smokeRoot,
      env: compatibilityEnv,
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
      env: compatibilityEnv,
      timeoutMs: 120_000,
    });
    assert(memoryReset.stdout.includes("Removed"), "Agentix memory compatibility reset did not route through Agentix backend");

    const execution = await fetchJson(`${inboxUrl}/execute`, {
      method: "POST",
      body: JSON.stringify({ stimulus: "release smoke task" }),
      timeoutMs: 60_000,
    });
    assert(execution.status === "complete", `execute status was ${execution.status}`);
    assert(Array.isArray(execution.taskIds) && execution.taskIds.length > 0, "execute did not return task ids");
    const plansAfterExecute = await fetchJson(`${inboxUrl}/plans`);
    assert(Array.isArray(plansAfterExecute) && plansAfterExecute.length > 0, "plans endpoint did not return execution");
    const planAction = await fetchJsonResponse(`${inboxUrl}/plans/${encodeURIComponent(plansAfterExecute[0].id)}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "cancel" }),
      timeoutMs: 60_000,
    });
    assert(planAction.status === 400, `completed plan cancellation returned ${planAction.status}`);
    assert(planAction.body.ok === false, "completed plan cancellation did not fail honestly");
    assert(planAction.body.status === "complete", "completed plan cancellation did not preserve terminal status");

    const streamed = await fetchText(`${inboxUrl}/execute/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    await new Promise((resolveClose) => llmServer.close(resolveClose));
  }

  assert(!serverOutput.toLowerCase().includes("error:"), `server emitted error output:\n${serverOutput}`);
}

try {
  await removeDirWithRetries(smokeRoot);
  smokeInstallScripts();
  const packedArtifact = await packAndInstall();
  await smokeColdShell();
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
