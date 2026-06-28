#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
const dataDir = process.env.AGENTIX_DATA_DIR
  ? resolve(process.env.AGENTIX_DATA_DIR)
  : resolve(process.cwd(), "data");
const configPath = join(dataDir, "config.json");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function envString(name) {
  const value = process.env[name]?.trim();
  if (!value || value === "undefined" || value === "null") return null;
  return value;
}

async function readDiskConfig() {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(await readFile(configPath, "utf-8"));
  } catch {
    return {};
  }
}

const diskConfig = await readDiskConfig();
const provider = (argValue("--provider") || envString("AGENTIX_PROVIDER") || diskConfig.provider || "auto")
  .trim()
  .toLowerCase();
const model = argValue("--model") || envString("AGENTIX_MODEL") || diskConfig.model || "claude-3-5-sonnet";
const baseUrl = argValue("--base-url") || envString("AGENTIX_BASE_URL") || diskConfig.baseUrl || null;
const apiKey = envString("AGENTIX_LLM_API_KEY");
const outputPath = argValue("--out") || envString("AGENTIX_LLM_VERIFY_OUTPUT");
const prompt = argValue("--prompt") || "Reply with exactly: agentix-live-ok";
const timeoutMs = Number(argValue("--timeout-ms") || envString("AGENTIX_LLM_VERIFY_TIMEOUT_MS") || 30000);

const openAiDefaults = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
  local: "http://127.0.0.1:11434/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
  "ollama-cloud": "https://ollama.com/v1",
};

function resolveProvider() {
  if (provider && provider !== "auto") return provider;
  const normalizedModel = model.toLowerCase();
  if (normalizedModel.includes("claude")) return "anthropic";
  if (normalizedModel.includes("openrouter/")) return "openrouter";
  if (normalizedModel.includes("deepseek")) return "deepseek";
  if (normalizedModel.includes("grok")) return "xai";
  return "openai";
}

function isLocalProvider(resolvedProvider, resolvedBaseUrl) {
  return resolvedProvider === "local"
    || resolvedProvider === "lmstudio"
    || resolvedBaseUrl.includes("127.0.0.1")
    || resolvedBaseUrl.includes("localhost");
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyOpenAICompatible(resolvedProvider) {
  const resolvedBaseUrl = (baseUrl || openAiDefaults[resolvedProvider] || "").replace(/\/+$/, "");
  if (!resolvedBaseUrl) throw new Error(`no base URL configured for provider ${resolvedProvider}`);
  if (!apiKey && !isLocalProvider(resolvedProvider, resolvedBaseUrl)) {
    throw new Error("AGENTIX_LLM_API_KEY is not configured");
  }
  const response = await fetchWithTimeout(`${resolvedBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are Agentix release verification. Keep answer exact." },
        { role: "user", content: prompt },
      ],
      temperature: 0,
    }),
  });
  if (!response.ok) throw new Error(`LLM API returned ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("LLM API response did not include message content");
  return { text, endpoint: `${resolvedBaseUrl}/chat/completions` };
}

async function verifyAnthropic() {
  if (!apiKey) throw new Error("AGENTIX_LLM_API_KEY is not configured");
  const resolvedBaseUrl = (baseUrl || "https://api.anthropic.com").replace(/\/+$/, "").replace(/\/v1$/, "");
  const response = await fetchWithTimeout(`${resolvedBaseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 64,
      system: "You are Agentix release verification. Keep answer exact.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`LLM API returned ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  const text = payload?.content
    ?.filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("LLM API response did not include text content");
  return { text, endpoint: `${resolvedBaseUrl}/v1/messages` };
}

async function writeProof(result) {
  if (!outputPath) return;
  const resolved = resolve(outputPath);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
  console.log(`[llm-verify] wrote proof ${resolved}`);
}

const resolvedProvider = resolveProvider();

try {
  const completion = resolvedProvider === "anthropic"
    ? await verifyAnthropic()
    : await verifyOpenAICompatible(resolvedProvider);
  const result = {
    ok: true,
    package: packageJson.name,
    version: packageJson.version,
    verifiedAt: new Date().toISOString(),
    provider: resolvedProvider,
    model,
    endpoint: completion.endpoint,
    responseChars: completion.text.length,
  };
  await writeProof(result);
  console.log(`[llm-verify] ${resolvedProvider}/${model} ok (${completion.text.length} chars)`);
} catch (err) {
  const result = {
    ok: false,
    package: packageJson.name,
    version: packageJson.version,
    verifiedAt: new Date().toISOString(),
    provider: resolvedProvider,
    model,
    error: err instanceof Error ? err.message : String(err),
  };
  await writeProof(result);
  console.error(`[llm-verify] failed: ${result.error}`);
  process.exitCode = 1;
}
