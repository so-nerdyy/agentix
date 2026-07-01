import { existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const INSTALL_ROOT = resolve(__dirname, "../..");
export const WORKSPACE_ROOT = process.env.AGENTIX_WORKSPACE_DIR
  ? resolve(process.env.AGENTIX_WORKSPACE_DIR)
  : process.cwd();
export const PROJECT_ROOT = WORKSPACE_ROOT;

function resolveCompatibilityRuntimeRoot(): string {
  const candidates = [
    resolve(INSTALL_ROOT, "hermes-agent", "hermes-agent-upstream"),
    resolve(INSTALL_ROOT, "hermes-agent-upstream"),
    resolve(INSTALL_ROOT, "hermes-agent"),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "pyproject.toml"))) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1]!;
}

export const COMPATIBILITY_RUNTIME_ROOT = resolveCompatibilityRuntimeRoot();

export const DATA_DIR = process.env.AGENTIX_DATA_DIR
  ? resolve(process.env.AGENTIX_DATA_DIR)
  : process.env.VITEST && WORKSPACE_ROOT === INSTALL_ROOT
    ? resolve(tmpdir(), "agentix-vitest", String(process.pid), "data")
  : resolve(WORKSPACE_ROOT, "data");

export const PATHS = {
  installRoot: INSTALL_ROOT,
  projectRoot: PROJECT_ROOT,
  workspaceRoot: WORKSPACE_ROOT,
  dataDir: DATA_DIR,
  compatibilityRuntimeRoot: COMPATIBILITY_RUNTIME_ROOT,
  compatibilityCLI: resolve(COMPATIBILITY_RUNTIME_ROOT, "cli.py"),
  compatibilityCliMain: resolve(COMPATIBILITY_RUNTIME_ROOT, "hermes_cli", "main.py"),
  distShell: resolve(INSTALL_ROOT, "dist", "shell"),
  bridgeEntry: resolve(INSTALL_ROOT, "dist", "bridge", "entry.js"),
  inboxEntry: resolve(INSTALL_ROOT, "dist", "config", "InboxServer.js"),
  configFile: join(DATA_DIR, "config.json"),
  sessionsDir: join(DATA_DIR, "sessions"),
  memoryDir: join(DATA_DIR, "memory"),
  sandboxesDir: join(DATA_DIR, "sandboxes"),
  logsDir: join(DATA_DIR, "logs"),
  vaultDir: join(DATA_DIR, "vault"),
  authDir: join(DATA_DIR, "auth"),
  authTokensFile: join(DATA_DIR, "auth", "tokens.json"),
  agentsDir: join(DATA_DIR, "agents"),
  agentProfilesFile: join(DATA_DIR, "agents", "profiles.json"),
} as const;

export function ensureDataDirs(): void {
  for (const dir of [
    PATHS.dataDir,
    PATHS.sessionsDir,
    PATHS.memoryDir,
    PATHS.sandboxesDir,
    PATHS.logsDir,
    PATHS.vaultDir,
    PATHS.authDir,
    PATHS.agentsDir,
  ]) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // ignore, callers will surface the relevant error if needed
    }
  }
}
