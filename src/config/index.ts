// Configuration loader for Agentix.
// Reads AGENTIX_* environment variables plus <dataDir>/config.json.
// API keys are never written to disk; they must come from env vars at runtime.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PATHS } from "./paths.js";

export interface AgentixConfig {
  model: string;
  provider: string;
  baseUrl: string | null;
  llmApiKey: string | null;
  sessionTtlMs: number;
  approvalTimeoutMs: number;
  dataDir: string;
  inboxPort: number;
  bridgePort: number;
  sessionToken: string | null;
}

const DEFAULTS: AgentixConfig = {
  model: process.env.AGENTIX_MODEL ?? "claude-3-5-sonnet",
  provider: process.env.AGENTIX_PROVIDER ?? "auto",
  baseUrl: process.env.AGENTIX_BASE_URL ?? null,
  llmApiKey: process.env.AGENTIX_LLM_API_KEY ?? null,
  sessionTtlMs: parseInt(process.env.AGENTIX_SESSION_TTL ?? "86400000", 10),
  approvalTimeoutMs: parseInt(
    process.env.AGENTIX_APPROVAL_TIMEOUT ?? "300000",
    10,
  ),
  dataDir: PATHS.dataDir,
  inboxPort: parseInt(process.env.AGENTIX_INBOX_PORT ?? "3000", 10),
  bridgePort: parseInt(process.env.AGENTIX_BRIDGE_PORT ?? "3456", 10),
  sessionToken: process.env.AGENTIX_SESSION_TOKEN ?? null,
};

function mergeFromDisk(): AgentixConfig {
  if (!existsSync(PATHS.configFile)) return { ...DEFAULTS };
  try {
    const raw = readFileSync(PATHS.configFile, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AgentixConfig>;
    // Never let api_key come from disk. Env wins; otherwise null.
    const { llmApiKey: _omit, ...rest } = parsed;
    return { ...DEFAULTS, ...rest, llmApiKey: DEFAULTS.llmApiKey };
  } catch {
    return { ...DEFAULTS };
  }
}

let cached: AgentixConfig | null = null;

export function loadConfig(): AgentixConfig {
  if (cached) return cached;
  cached = mergeFromDisk();
  return cached;
}

export function saveConfig(partial: Partial<AgentixConfig>): AgentixConfig {
  const current = loadConfig();
  const next: AgentixConfig = { ...current, ...partial };
  // Strip api key before writing to disk.
  const { llmApiKey: _omit, ...persisted } = next;
  writeFileSync(PATHS.configFile, JSON.stringify(persisted, null, 2), "utf-8");
  cached = next;
  return next;
}

export function resetConfigCache(): void {
  cached = null;
}
