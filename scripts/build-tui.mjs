#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tuiRoot = resolve(root, "hermes-agent", "ui-tui");
const sourceBundle = resolve(tuiRoot, "dist", "entry.js");
const packagedBundle = resolve(root, "hermes-agent", "hermes_cli", "tui_dist", "entry.js");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args) {
  const result = spawnSync(npm, args, {
    cwd: tuiRoot,
    env: { ...process.env, CI: "1" },
    shell: process.platform === "win32",
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    console.error(`Unable to run ${npm}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(resolve(tuiRoot, "node_modules"))) {
  run(["ci", "--no-audit", "--no-fund"]);
}
run(["run", "build"]);

mkdirSync(dirname(packagedBundle), { recursive: true });
copyFileSync(sourceBundle, packagedBundle);
console.log(`Packaged Agentix TUI: ${packagedBundle}`);
