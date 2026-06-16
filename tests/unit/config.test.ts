import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "agentix-config-"));
}

describe("config", () => {
  const envBackup = {
    AGENTIX_DATA_DIR: process.env.AGENTIX_DATA_DIR,
    AGENTIX_MODEL: process.env.AGENTIX_MODEL,
    AGENTIX_PROVIDER: process.env.AGENTIX_PROVIDER,
    AGENTIX_BASE_URL: process.env.AGENTIX_BASE_URL,
    AGENTIX_LLM_API_KEY: process.env.AGENTIX_LLM_API_KEY,
    AGENTIX_SESSION_TOKEN: process.env.AGENTIX_SESSION_TOKEN,
    AGENTIX_WORKSPACE_DIR: process.env.AGENTIX_WORKSPACE_DIR,
  };
  const dirs: string[] = [];

  function restoreEnv(key: keyof typeof envBackup): void {
    const value = envBackup[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  afterEach(() => {
    restoreEnv("AGENTIX_DATA_DIR");
    restoreEnv("AGENTIX_MODEL");
    restoreEnv("AGENTIX_PROVIDER");
    restoreEnv("AGENTIX_BASE_URL");
    restoreEnv("AGENTIX_LLM_API_KEY");
    restoreEnv("AGENTIX_SESSION_TOKEN");
    restoreEnv("AGENTIX_WORKSPACE_DIR");
    vi.resetModules();
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  it("loads env defaults and strips secrets from disk persistence", async () => {
    const dir = tempDir();
    dirs.push(dir);
    process.env.AGENTIX_DATA_DIR = dir;
    process.env.AGENTIX_MODEL = "test-model";
    process.env.AGENTIX_LLM_API_KEY = "secret-key";
    process.env.AGENTIX_SESSION_TOKEN = "session-secret";

    const configMod = await import("../../src/config/index.js");
    const pathsMod = await import("../../src/config/paths.js");

    const config = configMod.loadConfig();
    expect(config.model).toBe("test-model");
    expect(config.llmApiKey).toBe("secret-key");

    configMod.saveConfig({
      model: "saved-model",
      llmApiKey: "should-not-persist",
      sessionToken: "should-not-persist",
    });
    const raw = JSON.parse(readFileSync(pathsMod.PATHS.configFile, "utf-8"));

    expect(raw.model).toBe("saved-model");
    expect(raw.llmApiKey).toBeUndefined();
    expect(raw.sessionToken).toBeUndefined();
  });

  it("ignores secrets injected into the disk config", async () => {
    const dir = tempDir();
    dirs.push(dir);
    process.env.AGENTIX_DATA_DIR = dir;
    delete process.env.AGENTIX_LLM_API_KEY;
    delete process.env.AGENTIX_SESSION_TOKEN;
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        model: "disk-model",
        llmApiKey: "disk-api-secret",
        sessionToken: "disk-session-secret",
      }),
      "utf-8",
    );

    const configMod = await import("../../src/config/index.js");
    const config = configMod.loadConfig();

    expect(config.model).toBe("disk-model");
    expect(config.llmApiKey).toBeNull();
    expect(config.sessionToken).toBeNull();
  });

  it("treats undefined-like env strings as absent", async () => {
    const dir = tempDir();
    dirs.push(dir);
    process.env.AGENTIX_DATA_DIR = dir;
    process.env.AGENTIX_PROVIDER = "undefined";
    process.env.AGENTIX_BASE_URL = "null";
    process.env.AGENTIX_LLM_API_KEY = "undefined";

    const configMod = await import("../../src/config/index.js");
    const config = configMod.loadConfig();

    expect(config.provider).toBe("auto");
    expect(config.baseUrl).toBeNull();
    expect(config.llmApiKey).toBeNull();
  });

  it("defaults runtime state to the launch workspace instead of install root", async () => {
    const dir = tempDir();
    dirs.push(dir);
    delete process.env.AGENTIX_DATA_DIR;
    process.env.AGENTIX_WORKSPACE_DIR = dir;

    const pathsMod = await import("../../src/config/paths.js");

    expect(pathsMod.PATHS.projectRoot).toBe(resolve(dir));
    expect(pathsMod.PATHS.workspaceRoot).toBe(resolve(dir));
    expect(pathsMod.PATHS.dataDir).toBe(resolve(dir, "data"));
    expect(pathsMod.PATHS.installRoot).not.toBe(resolve(dir));
    expect(pathsMod.PATHS.bridgeEntry).toContain("dist");
  });
});
