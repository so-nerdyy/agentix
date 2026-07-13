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
    KILOCODE_API_KEY: process.env.KILOCODE_API_KEY,
    KILO_API_KEY: process.env.KILO_API_KEY,
    AGENTIX_SESSION_TOKEN: process.env.AGENTIX_SESSION_TOKEN,
    AGENTIX_WORKSPACE_DIR: process.env.AGENTIX_WORKSPACE_DIR,
    AGENTIX_SESSION_TTL: process.env.AGENTIX_SESSION_TTL,
    AGENTIX_APPROVAL_TIMEOUT: process.env.AGENTIX_APPROVAL_TIMEOUT,
    AGENTIX_INBOX_PORT: process.env.AGENTIX_INBOX_PORT,
    AGENTIX_BRIDGE_PORT: process.env.AGENTIX_BRIDGE_PORT,
    AGENTIX_LUNA_MODEL: process.env.AGENTIX_LUNA_MODEL,
    AGENTIX_TERRA_MODEL: process.env.AGENTIX_TERRA_MODEL,
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
    restoreEnv("KILOCODE_API_KEY");
    restoreEnv("KILO_API_KEY");
    restoreEnv("AGENTIX_SESSION_TOKEN");
    restoreEnv("AGENTIX_WORKSPACE_DIR");
    restoreEnv("AGENTIX_SESSION_TTL");
    restoreEnv("AGENTIX_APPROVAL_TIMEOUT");
    restoreEnv("AGENTIX_INBOX_PORT");
    restoreEnv("AGENTIX_BRIDGE_PORT");
    restoreEnv("AGENTIX_LUNA_MODEL");
    restoreEnv("AGENTIX_TERRA_MODEL");
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
    delete process.env.KILOCODE_API_KEY;
    delete process.env.KILO_API_KEY;
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

  it("loads setup secrets and model defaults from workspace .env.local", async () => {
    const workspace = tempDir();
    dirs.push(workspace);
    delete process.env.AGENTIX_MODEL;
    delete process.env.AGENTIX_PROVIDER;
    delete process.env.AGENTIX_BASE_URL;
    delete process.env.AGENTIX_LLM_API_KEY;
    delete process.env.KILOCODE_API_KEY;
    delete process.env.KILO_API_KEY;
    delete process.env.AGENTIX_SESSION_TOKEN;
    delete process.env.AGENTIX_DATA_DIR;
    process.env.AGENTIX_WORKSPACE_DIR = workspace;
    writeFileSync(
      join(workspace, ".env.local"),
      [
        "AGENTIX_PROVIDER=custom",
        "AGENTIX_MODEL=env-file-model",
        "AGENTIX_BASE_URL=https://gateway.example/v1",
        "AGENTIX_LLM_API_KEY=env-file-secret",
        "AGENTIX_SESSION_TOKEN=env-file-session",
        "",
      ].join("\n"),
      "utf-8",
    );

    const configMod = await import("../../src/config/index.js");
    const config = configMod.loadConfig();

    expect(config.provider).toBe("custom");
    expect(config.model).toBe("env-file-model");
    expect(config.baseUrl).toBe("https://gateway.example/v1");
    expect(config.llmApiKey).toBe("env-file-secret");
    expect(config.sessionToken).toBe("env-file-session");
  });

  it("accepts Kilo Gateway key aliases for first-class kilocode provider", async () => {
    const dir = tempDir();
    dirs.push(dir);
    process.env.AGENTIX_DATA_DIR = dir;
    process.env.AGENTIX_PROVIDER = "kilocode";
    process.env.AGENTIX_MODEL = "moonshotai/kimi-k2";
    delete process.env.AGENTIX_LLM_API_KEY;
    process.env.KILOCODE_API_KEY = "kilo-secret";

    const configMod = await import("../../src/config/index.js");
    const config = configMod.loadConfig();

    expect(config.provider).toBe("kilocode");
    expect(config.model).toBe("moonshotai/kimi-k2");
    expect(config.llmApiKey).toBe("kilo-secret");
  });

  it("accepts Kilo Gateway key aliases when older config stores provider openai with Kilo base URL", async () => {
    const dir = tempDir();
    dirs.push(dir);
    process.env.AGENTIX_DATA_DIR = dir;
    delete process.env.AGENTIX_PROVIDER;
    delete process.env.AGENTIX_MODEL;
    delete process.env.AGENTIX_LLM_API_KEY;
    process.env.KILOCODE_API_KEY = "kilo-secret";
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        provider: "openai",
        model: "stepfun/step-3.7-flash:free",
        baseUrl: "https://api.kilo.ai/api/gateway",
      }),
      "utf-8",
    );

    const configMod = await import("../../src/config/index.js");
    const config = configMod.loadConfig();

    expect(config.provider).toBe("openai");
    expect(config.baseUrl).toBe("https://api.kilo.ai/api/gateway");
    expect(config.llmApiKey).toBe("kilo-secret");
  });

  it("prefers process env over workspace .env.local", async () => {
    const workspace = tempDir();
    dirs.push(workspace);
    process.env.AGENTIX_WORKSPACE_DIR = workspace;
    process.env.AGENTIX_MODEL = "process-model";
    writeFileSync(
      join(workspace, ".env.local"),
      "AGENTIX_MODEL=file-model\nAGENTIX_LLM_API_KEY=file-secret\n",
      "utf-8",
    );

    const configMod = await import("../../src/config/index.js");
    const config = configMod.loadConfig();

    expect(config.model).toBe("process-model");
    expect(config.llmApiKey).toBe("file-secret");
  });

  it("prefers process and workspace environment over disk configuration", async () => {
    const workspace = tempDir();
    dirs.push(workspace);
    process.env.AGENTIX_WORKSPACE_DIR = workspace;
    process.env.AGENTIX_DATA_DIR = workspace;
    process.env.AGENTIX_MODEL = "process-model";
    process.env.AGENTIX_PROVIDER = "openai";
    writeFileSync(
      join(workspace, ".env.local"),
      "AGENTIX_BASE_URL=https://workspace.example/v1\n",
      "utf-8",
    );
    writeFileSync(
      join(workspace, "config.json"),
      JSON.stringify({
        model: "disk-model",
        provider: "anthropic",
        baseUrl: "https://disk.example/v1",
      }),
      "utf-8",
    );

    const configMod = await import("../../src/config/index.js");
    const config = configMod.loadConfig();

    expect(config.model).toBe("process-model");
    expect(config.provider).toBe("openai");
    expect(config.baseUrl).toBe("https://workspace.example/v1");
  });

  it("reloads workspace setup changes without re-importing the config module", async () => {
    const workspace = tempDir();
    dirs.push(workspace);
    process.env.AGENTIX_WORKSPACE_DIR = workspace;
    process.env.AGENTIX_DATA_DIR = workspace;
    delete process.env.AGENTIX_MODEL;
    delete process.env.AGENTIX_PROVIDER;
    delete process.env.AGENTIX_LLM_API_KEY;

    const configMod = await import("../../src/config/index.js");
    expect(configMod.loadConfig().model).toBe("claude-3-5-sonnet");

    writeFileSync(
      join(workspace, ".env.local"),
      [
        "AGENTIX_PROVIDER=openai",
        "AGENTIX_MODEL=setup-model",
        "AGENTIX_LLM_API_KEY=setup-secret",
        "AGENTIX_LUNA_MODEL=luna-worker",
        "AGENTIX_TERRA_MODEL=terra-worker",
        "",
      ].join("\n"),
      "utf-8",
    );
    configMod.resetConfigCache();

    expect(configMod.loadConfig()).toMatchObject({
      provider: "openai",
      model: "setup-model",
      llmApiKey: "setup-secret",
      lunaModel: "luna-worker",
      terraModel: "terra-worker",
    });
  });

  it("synchronizes config-set overrides with workspace environment precedence", async () => {
    const workspace = tempDir();
    dirs.push(workspace);
    process.env.AGENTIX_WORKSPACE_DIR = workspace;
    process.env.AGENTIX_DATA_DIR = workspace;
    delete process.env.AGENTIX_PROVIDER;
    writeFileSync(join(workspace, ".env.local"), "AGENTIX_PROVIDER=openai\n", "utf-8");

    const configMod = await import("../../src/config/index.js");
    expect(configMod.loadConfig().provider).toBe("openai");

    configMod.saveWorkspaceConfigOverride("provider", "local");
    configMod.saveConfig({ provider: "local" });

    expect(configMod.loadConfig().provider).toBe("local");
    expect(readFileSync(join(workspace, ".env.local"), "utf-8")).toContain(
      "AGENTIX_PROVIDER=local",
    );
  });

  it("bounds malformed numeric disk configuration and ignores invalid strings", async () => {
    const dir = tempDir();
    dirs.push(dir);
    process.env.AGENTIX_DATA_DIR = dir;
    delete process.env.AGENTIX_MODEL;
    delete process.env.AGENTIX_PROVIDER;
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        model: 42,
        provider: {},
        baseUrl: [],
        sessionTtlMs: -10,
        approvalTimeoutMs: "not-a-number",
        inboxPort: 99999,
        bridgePort: 0,
      }),
      "utf-8",
    );

    const configMod = await import("../../src/config/index.js");
    const config = configMod.loadConfig();

    expect(config.model).toBe("claude-3-5-sonnet");
    expect(config.provider).toBe("auto");
    expect(config.baseUrl).toBeNull();
    expect(config.sessionTtlMs).toBe(1000);
    expect(config.approvalTimeoutMs).toBe(300000);
    expect(config.inboxPort).toBe(65535);
    expect(config.bridgePort).toBe(1);
    expect(configMod.inspectConfigSources()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "disk-config",
        severity: "warn",
        detail: expect.stringContaining("model, provider"),
      }),
    ]));
  });

  it("reports malformed configuration without exposing file contents or blocking startup", async () => {
    const workspace = tempDir();
    dirs.push(workspace);
    process.env.AGENTIX_WORKSPACE_DIR = workspace;
    process.env.AGENTIX_DATA_DIR = workspace;
    delete process.env.AGENTIX_MODEL;
    delete process.env.AGENTIX_PROVIDER;
    writeFileSync(join(workspace, "config.json"), "{broken-secret-content", "utf-8");
    writeFileSync(join(workspace, ".env.local"), "AGENTIX_MODEL=valid-model\nBROKEN_LINE\n", "utf-8");

    const configMod = await import("../../src/config/index.js");
    const config = configMod.loadConfig();
    const issues = configMod.inspectConfigSources();

    expect(config.model).toBe("valid-model");
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "disk-config", severity: "fail" }),
      expect.objectContaining({ source: "workspace-env", severity: "warn" }),
    ]));
    expect(JSON.stringify(issues)).not.toContain("broken-secret-content");

    const { LocalAgentixRuntime } = await import("../../src/runtime/LocalAgentixRuntime.js");
    const runtime = new LocalAgentixRuntime();
    const doctor = runtime.doctor() as { checks: Array<{ id: string; status: string; detail: string }> };
    expect(doctor.checks).toContainEqual(expect.objectContaining({
      id: "config.sources",
      status: "fail",
      detail: expect.stringContaining("not valid JSON"),
    }));
    expect(doctor.checks).toContainEqual(expect.objectContaining({
      id: "state.integrity",
      status: "warn",
      detail: expect.stringContaining("invalid or unreadable JSON state"),
    }));
    expect(JSON.stringify(doctor)).not.toContain("broken-secret-content");
    runtime.shutdown();
  });

  it("treats undefined-like env strings as absent", async () => {
    const dir = tempDir();
    dirs.push(dir);
    process.env.AGENTIX_DATA_DIR = dir;
    process.env.AGENTIX_PROVIDER = "undefined";
    process.env.AGENTIX_BASE_URL = "null";
    process.env.AGENTIX_LLM_API_KEY = "undefined";
    delete process.env.KILOCODE_API_KEY;
    delete process.env.KILO_API_KEY;

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

  it("uses package metadata as the API version source of truth", async () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { name: string; version: string };
    const { PACKAGE_METADATA } = await import("../../src/config/package.js");
    const { openApiSpec } = await import("../../src/config/openapi.js");

    expect(PACKAGE_METADATA.name).toBe(pkg.name);
    expect(PACKAGE_METADATA.version).toBe(pkg.version);
    expect(openApiSpec.info.version).toBe(pkg.version);
  });
});
