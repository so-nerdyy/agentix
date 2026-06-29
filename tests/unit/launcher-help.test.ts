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
    expect(result.stdout).toContain("open the Agentix interactive shell");
    expect(result.stdout).toContain("Agentix commands:");
    expect(result.stdout).toContain("Agentix backend commands:");
    expect(result.stdout).toContain("setup");
    expect(result.stdout).toContain("server");
    expect(result.stdout).toContain("support");
    expect(result.stdout).toContain("plans");
    expect(result.stdout).toContain("tasks, task");
    expect(result.stdout).toContain("approvals, approval");
    expect(result.stdout).toContain("healing");
    expect(result.stdout).toContain("agents");
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

  it("routes Agentix-owned commands through the backend CLI", () => {
    const backendCommands = commandSet("BACKEND_COMMANDS");
    const hermesCommands = commandSet("HERMES_COMMANDS");
    const bridgelessCommands = commandSet("BRIDGELESS_HERMES_COMMANDS");

    expect(backendCommands).toContain("doctor");
    expect(backendCommands).toContain("status");
    expect(backendCommands).toContain("usage");
    expect(backendCommands).toContain("config");
    expect(backendCommands).toContain("sessions");
    expect(backendCommands).toContain("memory");
    expect(backendCommands).toContain("cron");
    expect(backendCommands).toContain("gateway");
    expect(backendCommands).toContain("logs");
    expect(backendCommands).toContain("tools");
    expect(backendCommands).toContain("task");
    expect(backendCommands).toContain("approval");
    expect(backendCommands).toContain("search");
    expect(backendCommands).toContain("audit");
    expect(backendCommands).toContain("healing");
    expect(backendCommands).toContain("agents");
    expect(backendCommands).toContain("auth");
    expect(hermesCommands).not.toContain("doctor");
    expect(hermesCommands).not.toContain("config");
    expect(hermesCommands).not.toContain("gateway");
    expect(hermesCommands).not.toContain("logs");
    expect(hermesCommands).not.toContain("auth");
    expect(bridgelessCommands).not.toContain("auth");
  });

  it("does not start the bridge for setup/model before configuration exists", () => {
    const launcher = readFileSync(join(process.cwd(), "bin", "agentix.js"), "utf8");

    expect(launcher).toContain('if (cmd === "setup")');
    expect(launcher).toContain('if (cmd === "model")');
    expect(launcher).toContain('if (cmd === "options")');
    expect(launcher).toContain("writeWorkspaceEnv");
    expect(launcher).toContain("writeWorkspaceConfig");
    expect(launcher).toContain("AGENTIX_HERMES_HOME");
    expect(launcher).toContain("parseHermesModelConfig");
    expect(launcher).toContain("AGENTIX_LLM_API_KEY");
  });

  it("opens the Agentix-owned shell for no-argument launches", () => {
    const launcher = readFileSync(join(process.cwd(), "bin", "agentix.js"), "utf8");

    expect(launcher).toContain("async function spawnNodeShell");
    expect(launcher).toContain("await spawnNodeShell();");
    expect(launcher).not.toContain("if (!cmd && process.stdin.isTTY) {\n    await ensureBridgeRunning();\n    await spawnHermes([]);");
  });

  it("detects Python instead of requiring a literal python command", () => {
    const launcher = readFileSync(join(process.cwd(), "bin", "agentix.js"), "utf8");
    const bridge = readFileSync(join(process.cwd(), "src", "shell", "hermes_python_bridge.ts"), "utf8");

    expect(launcher).toContain("AGENTIX_PYTHON");
    expect(launcher).toContain("python3");
    expect(launcher).toContain("py\", args: [\"-3\"]");
    expect(launcher.indexOf('command: "python"')).toBeLessThan(launcher.indexOf('command: "py"'));
    expect(bridge.indexOf('command: "python"')).toBeLessThan(bridge.indexOf('command: "py"'));
    expect(launcher).not.toContain('spawnSync("python", ["-m", "venv"');
  });
});
