// Configuration loader for Agentix.
// Reads AGENTIX_* environment variables, workspace .env.local, plus <dataDir>/config.json.
// Secrets may come from environment or .env.local, but are never persisted to JSON config.

import { readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "./paths.js";

export interface AgentixConfig {
  model: string;
  provider: string;
  baseUrl: string | null;
  llmApiKey: string | null;
  lunaModel: string | null;
  terraModel: string | null;
  sessionTtlMs: number;
  approvalTimeoutMs: number;
  dataDir: string;
  inboxPort: number;
  bridgePort: number;
  sessionToken: string | null;
}

export interface ConfigSourceIssue {
  source: "workspace-env" | "disk-config";
  path: string;
  severity: "warn" | "fail";
  detail: string;
}

function firstEnvString(keys: string[], workspaceEnv: Record<string, string>): string | null {
  for (const key of keys) {
    const value = envString(key, workspaceEnv);
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

function envString(key: string, workspaceEnv: Record<string, string>): string | null {
  const value = (process.env[key] ?? workspaceEnv[key])?.trim();
  if (!value || value === "undefined" || value === "null") return null;
  return value;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableString(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
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

export function inspectConfigSources(): ConfigSourceIssue[] {
  const issues: ConfigSourceIssue[] = [];
  const envFile = join(PATHS.workspaceRoot, ".env.local");
  if (existsSync(envFile)) {
    try {
      const lines = readFileSync(envFile, "utf-8").split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!.trim();
        if (!line || line.startsWith("#")) continue;
        if (!line.includes("=")) {
          issues.push({
            source: "workspace-env",
            path: envFile,
            severity: "warn",
            detail: `.env.local line ${index + 1} is missing '=' and was ignored`,
          });
          continue;
        }
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
          issues.push({
            source: "workspace-env",
            path: envFile,
            severity: "warn",
            detail: `.env.local line ${index + 1} has an invalid variable name and was ignored`,
          });
        }
        const value = line.slice(separator + 1).trim();
        if ((value.startsWith('"') && !value.endsWith('"')) ||
            (value.startsWith("'") && !value.endsWith("'"))) {
          issues.push({
            source: "workspace-env",
            path: envFile,
            severity: "warn",
            detail: `.env.local line ${index + 1} has an unterminated quoted value`,
          });
        }
      }
    } catch {
      issues.push({
        source: "workspace-env",
        path: envFile,
        severity: "fail",
        detail: ".env.local could not be read",
      });
    }
  }

  if (existsSync(PATHS.configFile)) {
    try {
      const parsed = JSON.parse(readFileSync(PATHS.configFile, "utf-8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        issues.push({
          source: "disk-config",
          path: PATHS.configFile,
          severity: "fail",
          detail: "config.json must contain a JSON object",
        });
      } else {
        const record = parsed as Record<string, unknown>;
        const invalidStrings = ["model", "provider"]
          .filter((key) => key in record && (typeof record[key] !== "string" || !String(record[key]).trim()));
        if (invalidStrings.length > 0) {
          issues.push({
            source: "disk-config",
            path: PATHS.configFile,
            severity: "warn",
            detail: `config.json has invalid string field(s): ${invalidStrings.join(", ")}`,
          });
        }
        const secretFields = ["llmApiKey", "sessionToken"]
          .filter((key) => typeof record[key] === "string" && Boolean(String(record[key])));
        if (secretFields.length > 0) {
          issues.push({
            source: "disk-config",
            path: PATHS.configFile,
            severity: "warn",
            detail: `config.json contains ignored secret field(s): ${secretFields.join(", ")}`,
          });
        }
      }
    } catch {
      issues.push({
        source: "disk-config",
        path: PATHS.configFile,
        severity: "fail",
        detail: "config.json is not valid JSON and was ignored",
      });
    }
  }
  return issues;
}

function mergeFromDisk(): AgentixConfig {
  const workspaceEnv = parseEnvFile(join(PATHS.workspaceRoot, ".env.local"));
  let disk: Partial<AgentixConfig> = {};
  try {
    if (existsSync(PATHS.configFile)) {
      const parsed = JSON.parse(readFileSync(PATHS.configFile, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        disk = parsed as Partial<AgentixConfig>;
      }
    }
  } catch {
    disk = {};
  }

  // Process environment wins over workspace .env.local, which wins over the
  // non-secret disk config. Values are resolved at load time so setup/model
  // changes become visible after resetConfigCache() without re-importing code.
  const provider = envString("AGENTIX_PROVIDER", workspaceEnv)
    ?? stringValue(disk.provider, "auto");
  const model = envString("AGENTIX_MODEL", workspaceEnv)
    ?? stringValue(disk.model, "claude-3-5-sonnet");
  const baseUrl = envString("AGENTIX_BASE_URL", workspaceEnv)
    ?? nullableString(disk.baseUrl, null);

  return {
    model,
    provider,
    baseUrl,
    llmApiKey: firstEnvString(providerApiKeyCandidates(provider, baseUrl), workspaceEnv),
    lunaModel: envString("AGENTIX_LUNA_MODEL", workspaceEnv)
      ?? nullableString(disk.lunaModel, null),
    terraModel: envString("AGENTIX_TERRA_MODEL", workspaceEnv)
      ?? nullableString(disk.terraModel, null),
    sessionTtlMs: boundedInteger(
      envString("AGENTIX_SESSION_TTL", workspaceEnv) ?? disk.sessionTtlMs,
      86_400_000,
      1_000,
      365 * 86_400_000,
    ),
    approvalTimeoutMs: boundedInteger(
      envString("AGENTIX_APPROVAL_TIMEOUT", workspaceEnv) ?? disk.approvalTimeoutMs,
      300_000,
      1_000,
      24 * 60 * 60_000,
    ),
    dataDir: PATHS.dataDir,
    inboxPort: boundedInteger(
      envString("AGENTIX_INBOX_PORT", workspaceEnv) ?? disk.inboxPort,
      3000,
      1,
      65_535,
    ),
    bridgePort: boundedInteger(
      envString("AGENTIX_BRIDGE_PORT", workspaceEnv) ?? disk.bridgePort,
      3456,
      1,
      65_535,
    ),
    sessionToken: envString("AGENTIX_SESSION_TOKEN", workspaceEnv),
  };
}

let cached: AgentixConfig | null = null;

const CONFIG_ENV_KEYS: Partial<Record<keyof AgentixConfig, string>> = {
  model: "AGENTIX_MODEL",
  provider: "AGENTIX_PROVIDER",
  baseUrl: "AGENTIX_BASE_URL",
  lunaModel: "AGENTIX_LUNA_MODEL",
  terraModel: "AGENTIX_TERRA_MODEL",
  sessionTtlMs: "AGENTIX_SESSION_TTL",
  approvalTimeoutMs: "AGENTIX_APPROVAL_TIMEOUT",
  inboxPort: "AGENTIX_INBOX_PORT",
  bridgePort: "AGENTIX_BRIDGE_PORT",
};

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
  cached = null;
  return loadConfig();
}

export function saveWorkspaceConfigOverride(
  key: keyof AgentixConfig,
  value: string | number | null,
): void {
  const envKey = CONFIG_ENV_KEYS[key];
  if (!envKey) return;
  const envFile = join(PATHS.workspaceRoot, ".env.local");
  const values = parseEnvFile(envFile);
  if (value === null || String(value).trim() === "") {
    delete values[envKey];
    delete process.env[envKey];
  } else {
    const normalized = String(value).replace(/\r?\n/g, "").trim();
    values[envKey] = normalized;
    process.env[envKey] = normalized;
  }
  const temporary = `${envFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    const content = Object.entries(values)
      .map(([name, current]) => `${name}=${current.replace(/\r?\n/g, "")}`)
      .join("\n");
    writeFileSync(temporary, content ? `${content}\n` : "", {
      encoding: "utf-8",
      mode: 0o600,
    });
    renameSync(temporary, envFile);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  cached = null;
}

export function resetConfigCache(): void {
  cached = null;
}
