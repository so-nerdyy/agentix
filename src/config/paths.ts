import { existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const INSTALL_ROOT = resolve(__dirname, "../..");
export const PROJECT_ROOT = INSTALL_ROOT;

function resolveHermesRoot(): string {
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

  return candidates[candidates.length - 1]!;
}

export const HERMES_ROOT = resolveHermesRoot();

export const DATA_DIR = process.env.AGENTIX_DATA_DIR
  ? resolve(process.env.AGENTIX_DATA_DIR)
  : resolve(PROJECT_ROOT, "data");

export const PATHS = {
  installRoot: INSTALL_ROOT,
  projectRoot: PROJECT_ROOT,
  dataDir: DATA_DIR,
  hermesRoot: HERMES_ROOT,
  hermesAgent: HERMES_ROOT,
  hermesCLI: resolve(HERMES_ROOT, "cli.py"),
  hermesCliMain: resolve(HERMES_ROOT, "hermes_cli", "main.py"),
  distShell: resolve(PROJECT_ROOT, "dist", "shell"),
  bridgeEntry: resolve(PROJECT_ROOT, "dist", "bridge", "entry.js"),
  inboxEntry: resolve(PROJECT_ROOT, "dist", "config", "InboxServer.js"),
  configFile: join(DATA_DIR, "config.json"),
  sessionsDir: join(DATA_DIR, "sessions"),
  memoryDir: join(DATA_DIR, "memory"),
  sandboxesDir: join(DATA_DIR, "sandboxes"),
  logsDir: join(DATA_DIR, "logs"),
  vaultDir: join(DATA_DIR, "vault"),
} as const;

export function ensureDataDirs(): void {
  for (const dir of [
    PATHS.dataDir,
    PATHS.sessionsDir,
    PATHS.memoryDir,
    PATHS.sandboxesDir,
    PATHS.logsDir,
    PATHS.vaultDir,
  ]) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // ignore, callers will surface the relevant error if needed
    }
  }
}
