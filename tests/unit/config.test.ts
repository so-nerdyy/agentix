import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "agentix-config-"));
}

describe("config", () => {
  const envBackup = {
    AGENTIX_DATA_DIR: process.env.AGENTIX_DATA_DIR,
    AGENTIX_MODEL: process.env.AGENTIX_MODEL,
    AGENTIX_LLM_API_KEY: process.env.AGENTIX_LLM_API_KEY,
    AGENTIX_WORKSPACE_DIR: process.env.AGENTIX_WORKSPACE_DIR,
  };
  const dirs: string[] = [];

  afterEach(() => {
    process.env.AGENTIX_DATA_DIR = envBackup.AGENTIX_DATA_DIR;
    process.env.AGENTIX_MODEL = envBackup.AGENTIX_MODEL;
    process.env.AGENTIX_LLM_API_KEY = envBackup.AGENTIX_LLM_API_KEY;
    process.env.AGENTIX_WORKSPACE_DIR = envBackup.AGENTIX_WORKSPACE_DIR;
    vi.resetModules();
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  it("loads env defaults and strips api keys from disk persistence", async () => {
    const dir = tempDir();
    dirs.push(dir);
    process.env.AGENTIX_DATA_DIR = dir;
    process.env.AGENTIX_MODEL = "test-model";
    process.env.AGENTIX_LLM_API_KEY = "secret-key";

    const configMod = await import("../../src/config/index.js");
    const pathsMod = await import("../../src/config/paths.js");

    const config = configMod.loadConfig();
    expect(config.model).toBe("test-model");
    expect(config.llmApiKey).toBe("secret-key");

    configMod.saveConfig({ model: "saved-model", llmApiKey: "should-not-persist" });
    const raw = JSON.parse(readFileSync(pathsMod.PATHS.configFile, "utf-8"));

    expect(raw.model).toBe("saved-model");
    expect(raw.llmApiKey).toBeUndefined();
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
