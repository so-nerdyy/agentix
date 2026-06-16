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
  model: envString("AGENTIX_MODEL") ?? "claude-3-5-sonnet",
  provider: envString("AGENTIX_PROVIDER") ?? "auto",
  baseUrl: envString("AGENTIX_BASE_URL"),
  llmApiKey: envString("AGENTIX_LLM_API_KEY"),
  sessionTtlMs: parseInt(envString("AGENTIX_SESSION_TTL") ?? "86400000", 10),
  approvalTimeoutMs: parseInt(
    envString("AGENTIX_APPROVAL_TIMEOUT") ?? "300000",
    10,
  ),
  dataDir: PATHS.dataDir,
  inboxPort: parseInt(envString("AGENTIX_INBOX_PORT") ?? "3000", 10),
  bridgePort: parseInt(envString("AGENTIX_BRIDGE_PORT") ?? "3456", 10),
  sessionToken: envString("AGENTIX_SESSION_TOKEN"),
};

function envString(key: string): string | null {
  const value = process.env[key]?.trim();
  if (!value || value === "undefined" || value === "null") return null;
  return value;
}

function mergeFromDisk(): AgentixConfig {
  if (!existsSync(PATHS.configFile)) return { ...DEFAULTS };
  try {
    const raw = readFileSync(PATHS.configFile, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AgentixConfig>;
    // Never let secrets come from disk. Environment wins; otherwise null.
    const {
      llmApiKey: _omitApiKey,
      sessionToken: _omitSessionToken,
      ...rest
    } = parsed;
    return {
      ...DEFAULTS,
      ...rest,
      llmApiKey: DEFAULTS.llmApiKey,
      sessionToken: DEFAULTS.sessionToken,
    };
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
  // Strip secrets before writing to disk.
  const {
    llmApiKey: _omitApiKey,
    sessionToken: _omitSessionToken,
    ...persisted
  } = next;
  writeFileSync(PATHS.configFile, JSON.stringify(persisted, null, 2), "utf-8");
  cached = next;
  return next;
}

export function resetConfigCache(): void {
  cached = null;
}
