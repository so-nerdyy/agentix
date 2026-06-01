// Central path configuration for the project.
// All file-resolution logic should go through PATHS
// rather than scattering process.cwd() or __dirname calls.

import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

// The project root is two levels up from this file's directory
// (src/config/paths.ts → src/ → project root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const INSTALL_ROOT = resolve(__dirname, "../..");
export const PROJECT_ROOT = INSTALL_ROOT;

// Agentix data directory. Override with AGENTIX_DATA_DIR; defaults to
// <projectRoot>/data. All persistent state (sessions, memory, sandboxes,
// logs, vault) lives under here.
export const DATA_DIR = process.env.AGENTIX_DATA_DIR
  ? resolve(process.env.AGENTIX_DATA_DIR)
  : resolve(PROJECT_ROOT, "data");

// Paths used across the codebase
export const PATHS = {
  installRoot: INSTALL_ROOT,
  projectRoot: PROJECT_ROOT,
  dataDir: DATA_DIR,

  // Phase 1 paths (existing)
  hermesAgent: resolve(PROJECT_ROOT, "hermes-agent"),
  hermesCLI: resolve(PROJECT_ROOT, "hermes-agent", "cli.py"),
  hermesCliMain: resolve(PROJECT_ROOT, "hermes-agent"),
  distShell: resolve(PROJECT_ROOT, "dist", "shell"),
  bridgeEntry: resolve(PROJECT_ROOT, "dist", "bridge", "entry.js"),
  inboxEntry: resolve(PROJECT_ROOT, "dist", "config", "InboxServer.js"),

  // Phase 2 paths
  configFile: join(DATA_DIR, "config.json"),
  sessionsDir: join(DATA_DIR, "sessions"),
  memoryDir: join(DATA_DIR, "memory"),
  sandboxesDir: join(DATA_DIR, "sandboxes"),
  logsDir: join(DATA_DIR, "logs"),
  vaultDir: join(DATA_DIR, "vault"),
} as const;

export function ensureDataDirs(): void {
  // Best-effort. If we can't create them, individual modules will fail
  // with a clearer error at the call site.
  for (const dir of [
    PATHS.dataDir,
    PATHS.sessionsDir,
    PATHS.memoryDir,
    PATHS.sandboxesDir,
    PATHS.logsDir,
    PATHS.vaultDir,
  ]) {
    try {
      // require("fs") lazily so the bundle stays tree-shakable
      const { mkdirSync } = require("node:fs") as typeof import("node:fs");
      mkdirSync(dir, { recursive: true });
    } catch {
      // ignore — module-level caller will surface the real error
    }
  }
}
