// Configuration loader for Agentix.
// Reads AGENTIX_* environment variables, workspace .env.local, plus <dataDir>/config.json.
// Secrets may come from environment or .env.local, but are never persisted to JSON config.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

const WORKSPACE_ENV = parseEnvFile(join(PATHS.workspaceRoot, ".env.local"));

function firstEnvString(keys: string[]): string | null {
  for (const key of keys) {
    const value = envString(key);
    if (value) return value;
  }
  return null;
}

function providerApiKeyCandidates(provider: string | null, baseUrl: string | null): string[] {
  const normalizedProvider = (provider ?? "").toLowerCase();
  const normalizedBaseUrl = (baseUrl ?? "").toLowerCase();
  if (normalizedProvider.includes("kilo") || normalizedBaseUrl.includes("api.kilo.ai")) {
    return ["AGENTIX_LLM_API_KEY", "KILOCODE_API_KEY", "KILO_API_KEY", "OPENAI_API_KEY"];
  }
  if (normalizedProvider.includes("anthropic") || normalizedProvider.includes("claude")) {
    return ["AGENTIX_LLM_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN"];
  }
  if (normalizedProvider.includes("openrouter")) {
    return ["AGENTIX_LLM_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY"];
  }
  return ["AGENTIX_LLM_API_KEY"];
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
  const value = (process.env[key] ?? WORKSPACE_ENV[key])?.trim();
  if (!value || value === "undefined" || value === "null") return null;
  return value;
}

function parseEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const values: Record<string, string> = {};
  try {
    for (const rawLine of readFileSync(file, "utf-8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const [rawKey, ...rawValue] = line.split("=");
      const key = rawKey.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      let value = rawValue.join("=").trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
  } catch {
    return {};
  }
  return values;
}

function mergeFromDisk(): AgentixConfig {
  if (!existsSync(PATHS.configFile)) {
    return {
      ...DEFAULTS,
      llmApiKey: firstEnvString(providerApiKeyCandidates(DEFAULTS.provider, DEFAULTS.baseUrl)),
    };
  }
  try {
    const raw = readFileSync(PATHS.configFile, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AgentixConfig>;
    // Never let secrets come from disk. Environment wins; otherwise null.
    const {
      llmApiKey: _omitApiKey,
      sessionToken: _omitSessionToken,
      ...rest
    } = parsed;
    const merged = {
      ...DEFAULTS,
      ...rest,
      sessionToken: DEFAULTS.sessionToken,
    };
    return {
      ...merged,
      llmApiKey: firstEnvString(providerApiKeyCandidates(merged.provider, merged.baseUrl)),
    };
  } catch {
    return {
      ...DEFAULTS,
      llmApiKey: firstEnvString(providerApiKeyCandidates(DEFAULTS.provider, DEFAULTS.baseUrl)),
    };
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
