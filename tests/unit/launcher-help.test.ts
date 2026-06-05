import { spawnSync } from "child_process";
import { join } from "path";
import { describe, expect, it } from "vitest";

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

  it("documents launch flags for dashboard and server", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "bin", "agentix.js"), "--help"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("flags: --port <n> --bridge-port <n> --host <addr>");
    expect(result.stdout).toContain("flags: --port <n> --host <addr>");
  });
});
