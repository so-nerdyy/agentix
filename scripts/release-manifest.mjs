import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), "..");
const outDir = resolve(process.env.AGENTIX_RELEASE_DIR || join(root, ".release"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const artifactBase = (process.env.AGENTIX_RELEASE_ARTIFACT_BASE
  || pkg.name.replace(/^@/, "").replace(/[\/\\]/g, "-"));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32" && /\.cmd$/i.test(command),
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
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

await mkdir(outDir, { recursive: true });

const packed = parseNpmPackJson(run(npm, ["pack", "--pack-destination", outDir, "--json"]));
const filename = packed[0]?.filename;
if (!filename) throw new Error("npm pack did not return a filename");
const tarball = join(outDir, filename);
if (!existsSync(tarball)) throw new Error(`packed tarball missing: ${tarball}`);

let gitCommit = null;
try {
  gitCommit = run("git", ["rev-parse", "HEAD"]);
} catch {
  gitCommit = null;
}

const manifest = {
  package: pkg.name,
  version: pkg.version,
  generatedAt: new Date().toISOString(),
  gitCommit,
  tarball: filename,
  sizeBytes: statSync(tarball).size,
  sha256: sha256(tarball),
  install: {
    npm: `npm install -g ${pkg.name}@${pkg.version}`,
    tarball: `AGENTIX_PACKAGE=${filename} AGENTIX_EXPECTED_SHA256=<sha256> sh install.sh`,
    powershell: `$env:AGENTIX_PACKAGE='${filename}'; $env:AGENTIX_EXPECTED_SHA256='<sha256>'; ./install.ps1`,
  },
};

const manifestPath = join(outDir, `${artifactBase}-${pkg.version}-manifest.json`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

console.log(`Wrote ${manifestPath}`);
console.log(`Tarball ${filename}`);
console.log(`SHA256 ${manifest.sha256}`);
