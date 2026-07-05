#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const args = process.argv.slice(2);

function argValue(name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function envString(name) {
  const value = process.env[name]?.trim();
  if (!value || value === "undefined" || value === "null") return null;
  return value;
}

function run(command, commandArgs, opts = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, commandArgs, {
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
      resolveRun({ ok: false, stdout, stderr, error: `${command} ${commandArgs.join(" ")} timed out` });
    }, opts.timeoutMs ?? 30_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      resolveRun({ ok: false, stdout, stderr, error: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolveRun({ ok: code === 0, stdout, stderr, code });
    });
  });
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, text };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, status: response.status, text: err instanceof Error ? err.message : String(err) };
  }
}

function add(results, id, ok, detail, action, severity = "fail") {
  results.push({ id, ok, detail, action, severity });
}

function packageRepositoryUrl() {
  if (typeof pkg.repository === "string") {
    return pkg.repository.trim();
  }
  if (pkg.repository && typeof pkg.repository === "object" && typeof pkg.repository.url === "string") {
    return pkg.repository.url.trim();
  }
  return "";
}

function print(results) {
  for (const item of results) {
    const marker = item.ok ? "PASS" : item.severity === "warn" ? "WARN" : "FAIL";
    console.log(`[${marker}] ${item.id}: ${item.detail}`);
    if (!item.ok && item.action) console.log(`       action: ${item.action}`);
  }
}

const repository = argValue("--repo", envString("AGENTIX_REPOSITORY") || "so-nerdyy/agentix");
const version = argValue("--version", envString("AGENTIX_VERSION") || pkg.version);
const tag = argValue("--tag", `v${version}`);
const requireLlm = hasFlag("--require-llm") || envString("AGENTIX_PREFLIGHT_REQUIRE_LLM") === "1";
let token = envString("GITHUB_TOKEN") || envString("GH_TOKEN");
const npmToken = envString("NODE_AUTH_TOKEN") || envString("NPM_TOKEN");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const results = [];

if (!token) {
  const ghToken = await run("gh", ["auth", "token"], { timeoutMs: 15_000 });
  if (ghToken.ok && ghToken.stdout.trim()) {
    token = ghToken.stdout.trim();
  }
}

if (!pkg.name.startsWith("@")) {
  add(results, "package.scope", false, `${pkg.name} is unscoped`, "Use a scoped npm package you control, e.g. @nerdyy/agentix.");
} else {
  add(results, "package.scope", true, pkg.name);
}

const expectedRepositoryUrl = `https://github.com/${repository}`;
const actualRepositoryUrl = packageRepositoryUrl();
add(
  results,
  "package.repository",
  actualRepositoryUrl === expectedRepositoryUrl,
  actualRepositoryUrl ? `repository.url=${actualRepositoryUrl}` : "repository.url missing",
  `Set package.json repository.url to ${expectedRepositoryUrl}; npm provenance requires it to match the GitHub repository.`,
);

const repoHeaders = {
  Accept: "application/vnd.github+json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};
const repoResult = await fetchJson(`https://api.github.com/repos/${repository}`, repoHeaders);
if (!repoResult.ok) {
  add(results, "github.repo", false, `GitHub API returned ${repoResult.status}`, "Make the repository public or provide GITHUB_TOKEN/GH_TOKEN with repo access.");
} else if (repoResult.value.private) {
  add(results, "github.repo", false, `${repository} is private`, "Make the repository public before claiming public curl/GitHub release install.");
} else {
  add(results, "github.repo", true, `${repository} is public`);
}

const releaseResult = await fetchJson(`https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, repoHeaders);
if (!releaseResult.ok) {
  add(results, "github.release", true, `${tag} not published yet`, "This is expected before first release; tag push will create the release.", "warn");
} else {
  const assets = Array.isArray(releaseResult.value.assets) ? releaseResult.value.assets : [];
  const hasTarball = assets.some((asset) => String(asset.name ?? "").endsWith(".tgz"));
  const hasManifest = assets.some((asset) => String(asset.name ?? "").endsWith("-manifest.json"));
  add(
    results,
    "github.release",
    hasTarball && hasManifest,
    `${tag} assets: tarball=${hasTarball} manifest=${hasManifest}`,
    "Rerun release workflow after fixing release asset generation.",
    hasTarball && hasManifest ? "fail" : "warn",
  );
}

const npmPackage = await run(npm, ["view", pkg.name, "name", "version", "--json"], { timeoutMs: 60_000 });
if (npmPackage.ok) {
  let metadata = {};
  try {
    metadata = JSON.parse(npmPackage.stdout);
  } catch {
    metadata = {};
  }
  const publishedVersion = String(metadata.version ?? "");
  add(
    results,
    "npm.package",
    publishedVersion !== version,
    publishedVersion === version
      ? `${pkg.name}@${version} already exists`
      : `${pkg.name} exists; latest=${publishedVersion || "unknown"}`,
    "Bump package.json version before publishing again.",
    publishedVersion === version ? "fail" : "warn",
  );
} else if (`${npmPackage.stdout}\n${npmPackage.stderr}`.includes("E404")) {
  add(results, "npm.package", true, `${pkg.name} not published yet; first publish allowed`);
} else {
  add(results, "npm.package", false, `npm view failed: ${(npmPackage.stderr || npmPackage.error || "").trim()}`, "Check npm registry/network access.");
}

if (!npmToken) {
  add(results, "npm.auth", false, "NPM_TOKEN/NODE_AUTH_TOKEN missing", "Add NPM_TOKEN repo secret with publish rights for the npm scope.");
} else {
  const whoami = await run(npm, ["whoami"], {
    timeoutMs: 60_000,
    env: {
      ...process.env,
      NODE_AUTH_TOKEN: npmToken,
    },
  });
  add(
    results,
    "npm.auth",
    whoami.ok,
    whoami.ok ? `authenticated as ${whoami.stdout.trim()}` : "npm token rejected",
    "Refresh NPM_TOKEN with automation/publish permission.",
  );
  if (whoami.ok) {
    const dryRun = await run(npm, ["publish", "--dry-run", "--access", "public"], {
      timeoutMs: 120_000,
      env: {
        ...process.env,
        NODE_AUTH_TOKEN: npmToken,
      },
    });
    add(
      results,
      "npm.publish_dry_run",
      dryRun.ok,
      dryRun.ok ? "npm publish dry-run completed" : "npm publish dry-run failed",
      "Check package files, npm token publish scope, and package access settings before tagging release.",
    );
  }
}

const llmKey = envString("AGENTIX_LLM_API_KEY") || envString("KILOCODE_API_KEY") || envString("KILO_API_KEY");
add(
  results,
  "llm.secret",
  Boolean(llmKey) || !requireLlm,
  llmKey ? "live LLM API key configured" : "AGENTIX_LLM_API_KEY/KILOCODE_API_KEY missing",
  "Add AGENTIX_LLM_API_KEY or KILOCODE_API_KEY secret, or run npm run verify:llm manually before public readiness.",
  requireLlm ? "fail" : "warn",
);

print(results);
const failures = results.filter((item) => !item.ok && item.severity !== "warn");
if (failures.length > 0) {
  console.error(`release preflight failed: ${failures.map((item) => item.id).join(", ")}`);
  process.exitCode = 1;
}
