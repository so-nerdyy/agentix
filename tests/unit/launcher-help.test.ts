import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import { describe, expect, it } from "vitest";

function commandSet(name: string) {
  const launcher = readFileSync(join(process.cwd(), "bin", "agentix.js"), "utf8");
  const match = launcher.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  expect(match).not.toBeNull();
  return new Set(Array.from(match![1].matchAll(/"([^"]+)"/g), (item) => item[1]));
}

describe("launcher help", () => {
  it("advertises the merged shell and backend command surface", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "--help"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("open the Hermes-style interactive shell");
    expect(result.stdout).toContain("Hermes shell commands:");
    expect(result.stdout).toContain("Agentix backend commands:");
    expect(result.stdout).toContain("setup");
    expect(result.stdout).toContain("server");
    expect(result.stdout).toContain("support");
    expect(result.stdout).toContain("plans");
    expect(result.stdout).toContain("--bridge-port");
  });

  it("shows command help instead of starting backend commands", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "server", "--help"], {
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: agentix server");
    expect(result.stdout).toContain("backend bridge/API and inbox server");
    expect(result.stdout).not.toContain("Agentix dashboard available");
  });

  it("prints local help for help <backend-command>", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "help", "server"], {
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: agentix server");
    expect(result.stdout).toContain("backend bridge/API and inbox server");
  });

  it("prints Agentix help for backend-adapted Hermes commands", () => {
    const gateway = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "gateway", "--help"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    const logs = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "help", "logs"], {
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(gateway.status).toBe(0);
    expect(gateway.stdout).toContain("Agentix backend runtime");
    expect(logs.status).toBe(0);
    expect(logs.stdout).toContain("persisted runtime log entries");
  });

  it("documents launch flags for dashboard and server", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "--help"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("flags: --port <n> --bridge-port <n> --host <addr>");
    expect(result.stdout).toContain("flags: --port <n> --host <addr>");
  });

  it("routes Hermes-owned UX commands through Hermes before backend CLI", () => {
    const backendCommands = commandSet("BACKEND_COMMANDS");
    const hermesCommands = commandSet("HERMES_COMMANDS");

    expect(hermesCommands).toContain("gateway");
    expect(hermesCommands).toContain("logs");
    expect(backendCommands).not.toContain("gateway");
    expect(backendCommands).not.toContain("logs");
  });

  it("does not start the bridge for setup/model before configuration exists", () => {
    const launcher = readFileSync(join(process.cwd(), "bin", "agentix.js"), "utf8");
    const bridgelessCommands = commandSet("BRIDGELESS_HERMES_COMMANDS");

    expect(bridgelessCommands).toContain("setup");
    expect(bridgelessCommands).toContain("model");
    expect(launcher).toContain("AGENTIX_HERMES_HOME");
    expect(launcher).toContain("parseHermesModelConfig");
    expect(launcher).toContain("AGENTIX_LLM_API_KEY");
  });
});
