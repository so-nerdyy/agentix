import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));

const args = process.argv.slice(2);

function readArg(name, fallback = undefined) {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const value = args[idx + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function log(message) {
  console.log(`[verify-release] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  if (!response.ok) {
    fail(`${url} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    fail(`${url} returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function sha256(bytes) {
  const hash = createHash("sha256");
  hash.update(bytes);
  return hash.digest("hex");
}

function run(command, args, opts = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: opts.cwd ?? root,
      env: opts.env ?? process.env,
      shell: process.platform === "win32" && /\.cmd$/i.test(command),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      rejectRun(new Error(`${command} ${args.join(" ")} timed out`));
    }, opts.timeoutMs ?? 120_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      rejectRun(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      rejectRun(new Error(`${command} ${args.join(" ")} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

async function verifyNpm(packageName, version) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`;
  log(`checking npm package ${packageName}@${version}`);
  const metadata = await fetchJson(url);
  if (metadata.name !== packageName) fail(`npm package name mismatch: ${metadata.name}`);
  if (metadata.version !== version) fail(`npm package version mismatch: ${metadata.version}`);
  if (!metadata.dist?.tarball) fail("npm metadata missing dist.tarball");
  if (!metadata.dist?.integrity && !metadata.dist?.shasum) fail("npm metadata missing dist integrity/shasum");
  const attestationsUrl = metadata.dist?.attestations?.url ?? null;
  if (!attestationsUrl) fail("npm metadata missing dist.attestations.url; publish must use npm provenance");
  const provenancePredicate = metadata.dist?.attestations?.provenance?.predicateType ?? "";
  if (!String(provenancePredicate).startsWith("https://slsa.dev/provenance/")) {
    fail(`npm metadata missing SLSA provenance predicate: ${String(provenancePredicate || "none")}`);
  }
  log(`checking npm provenance attestations ${attestationsUrl}`);
  const attestations = await fetchJson(attestationsUrl);
  if (!Array.isArray(attestations.attestations) || attestations.attestations.length === 0) {
    fail("npm attestations endpoint returned no attestations");
  }
  return {
    tarball: metadata.dist.tarball,
    integrity: metadata.dist.integrity ?? null,
    shasum: metadata.dist.shasum ?? null,
    attestations: {
      url: attestationsUrl,
      predicateType: provenancePredicate,
      count: attestations.attestations.length,
      provenance: true,
    },
  };
}

async function verifyGitHubRelease(packageName, version, releaseBaseUrl, artifactBase) {
  const manifestUrl = `${releaseBaseUrl.replace(/\/+$/, "")}/${artifactBase}-${version}-manifest.json`;
  log(`checking release manifest ${manifestUrl}`);
  const manifest = await fetchJson(manifestUrl);
  if (manifest.package !== packageName) fail(`release manifest package mismatch: ${manifest.package}`);
  if (manifest.version !== version) fail(`release manifest version mismatch: ${manifest.version}`);
  if (!manifest.tarball) fail("release manifest missing tarball");
  if (!manifest.sha256) fail("release manifest missing sha256");

  const tarballUrl = `${releaseBaseUrl.replace(/\/+$/, "")}/${manifest.tarball}`;
  log(`checking release tarball SHA256 ${tarballUrl}`);
  const tarball = await fetchBytes(tarballUrl);
  const actual = sha256(tarball);
  if (actual !== manifest.sha256) {
    fail(`release tarball SHA256 mismatch. Expected ${manifest.sha256}, got ${actual}`);
  }
  return { manifestUrl, tarballUrl, sha256: actual, tarballName: manifest.tarball };
}

async function verifyInstaller(version, releaseBaseUrl) {
  log("checking installer dry-run against release assets");
  if (process.platform === "win32") {
    const result = await run("powershell", ["-ExecutionPolicy", "Bypass", "-File", join(root, "install.ps1"), "-DryRun", "-SkipSetup"], {
      env: {
        ...process.env,
        AGENTIX_VERSION: version,
        AGENTIX_RELEASE_BASE_URL: releaseBaseUrl,
      },
    });
    if (!result.stdout.includes("Verified SHA256")) fail("PowerShell installer did not verify SHA256");
    return;
  }
  const result = await run("sh", [join(root, "install.sh")], {
    env: {
      ...process.env,
      AGENTIX_VERSION: version,
      AGENTIX_RELEASE_BASE_URL: releaseBaseUrl,
      AGENTIX_DRY_RUN: "1",
      AGENTIX_SKIP_SETUP: "1",
    },
  });
  if (!result.stdout.includes("Verified SHA256")) fail("shell installer did not verify SHA256");
}

async function verifyNpmGlobalInstall(packageName, version) {
  log(`checking isolated npm install -g ${packageName}@${version}`);
  const prefix = await mkdtemp(join(tmpdir(), "agentix-public-install-"));
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const agentix = process.platform === "win32"
    ? join(prefix, "agentix.cmd")
    : join(prefix, "bin", "agentix");
  try {
    await run(npm, ["install", "-g", "--prefix", prefix, `${packageName}@${version}`, "--no-audit", "--no-fund"], {
      timeoutMs: 240_000,
    });
    const versionResult = await run(agentix, ["version"], { timeoutMs: 60_000 });
    if (!versionResult.stdout.includes(`Agentix v${version}`)) {
      fail(`installed agentix version mismatch: ${versionResult.stdout.trim()}`);
    }
    const helpResult = await run(agentix, ["help"], { timeoutMs: 60_000 });
    if (!helpResult.stdout.includes("open the Agentix interactive shell")) {
      fail("installed agentix help missing shell launch text");
    }
    return {
      prefix,
      agentixVersion: versionResult.stdout.trim(),
      helpChecked: true,
    };
  } finally {
    await rm(prefix, { recursive: true, force: true }).catch((error) => {
      console.warn(`warning: unable to remove verification prefix ${prefix}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

const packageName = readArg("--package", process.env.AGENTIX_VERIFY_PACKAGE ?? pkg.name);
const version = readArg("--version", process.env.AGENTIX_VERSION ?? process.env.AGENTIX_VERIFY_VERSION ?? pkg.version);
const releaseBaseUrl = readArg(
  "--release-base-url",
  process.env.AGENTIX_RELEASE_BASE_URL ?? process.env.AGENTIX_VERIFY_RELEASE_BASE_URL ?? `https://github.com/so-nerdyy/agentix/releases/download/v${version}`,
);
const skipNpm = hasFlag("--skip-npm") || process.env.AGENTIX_VERIFY_SKIP_NPM === "1";
const skipNpmInstall = hasFlag("--skip-npm-install") || process.env.AGENTIX_VERIFY_SKIP_NPM_INSTALL === "1" || skipNpm;
const skipInstaller = hasFlag("--skip-installer") || process.env.AGENTIX_VERIFY_SKIP_INSTALLER === "1";
const outputPath = readArg("--out", process.env.AGENTIX_VERIFY_OUTPUT);
const artifactBase = readArg(
  "--artifact-base",
  process.env.AGENTIX_RELEASE_ARTIFACT_BASE ?? packageName.replace(/^@/, "").replace(/[\/\\]/g, "-"),
);

const npmResult = skipNpm ? null : await verifyNpm(packageName, version);
const releaseResult = await verifyGitHubRelease(packageName, version, releaseBaseUrl, artifactBase);
const npmInstallResult = skipNpmInstall ? null : await verifyNpmGlobalInstall(packageName, version);
if (!skipInstaller) {
  await verifyInstaller(version, releaseBaseUrl);
}

const result = {
  ok: true,
  package: packageName,
  version,
  releaseBaseUrl,
  artifactBase,
  npm: npmResult,
  npmInstall: npmInstallResult,
  release: releaseResult,
  installerDryRun: !skipInstaller,
  verifiedAt: new Date().toISOString(),
};

if (outputPath) {
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf-8");
  log(`wrote proof ${outputPath}`);
}

console.log(JSON.stringify(result, null, 2));
