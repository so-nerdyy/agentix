import { describe, expect, it } from "vitest";
import { buildHelpText } from "../../src/cli/help.js";

describe("CLI help", () => {
  it("advertises the current product entrypoints", () => {
    const help = buildHelpText("test-version");

    expect(help).toContain("agentix <command>");
    expect(help).toContain("dashboard");
    expect(help).toContain("logs");
    expect(help).toContain("doctor");
    expect(help).toContain("readiness");
    expect(help).toContain("plans, plan");
    expect(help).toContain("tasks, task");
    expect(help).toContain("approvals, approval");
    expect(help).toContain("search");
    expect(help).toContain("audit");
    expect(help).toContain("healing");
    expect(help).toContain("agents");
    expect(help).toContain("support");
    expect(help).toContain("server");
    expect(help).toContain("plugin, extension");
    expect(help).toContain("eval, broadcast");
  });
});
