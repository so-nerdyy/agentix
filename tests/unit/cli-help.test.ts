import { describe, expect, it } from "vitest";
import { buildHelpText } from "../../src/cli/help.js";

describe("CLI help", () => {
  it("advertises the current product entrypoints", () => {
    const help = buildHelpText("test-version");

    expect(help).toContain("agentix <command>");
    expect(help).toContain("dashboard");
    expect(help).toContain("logs");
    expect(help).toContain("doctor");
    expect(help).toContain("support");
    expect(help).toContain("server");
    expect(help).toContain("plugin, extension");
    expect(help).toContain("eval, broadcast");
  });
});
