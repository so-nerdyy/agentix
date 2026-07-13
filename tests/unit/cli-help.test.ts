import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
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

  it("contains the backend one-shot command implementation", () => {
    const cli = readFileSync(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(cli).toContain('case "oneshot"');
    expect(cli).toContain("Usage: agentix -z <prompt>");
    expect(cli).toContain("model: modelArg");
    expect(cli).toContain("provider: providerArg");
    expect(cli).toContain("baseUrl: baseUrlArg");
    expect(cli).toContain("toolsets: toolsetsArg");
  });

  it("treats list as a list alias for audit and healing commands", () => {
    const cli = readFileSync(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(cli).toContain('auditId !== "list"');
    expect(cli).toContain('entryId === "list"');
    expect(cli).toContain('entryId === "stats"');
  });

  it("reports an empty scheduler list instead of succeeding silently", () => {
    const cli = readFileSync(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(cli).toContain("const jobs = runtime.listJobs();");
    expect(cli).toContain('console.log("No scheduled jobs.");');
  });

  it("keeps documented cron pause, resume, and history actions executable", () => {
    const cli = readFileSync(join(process.cwd(), "src", "cli.ts"), "utf8");
    const launcher = [
      readFileSync(join(process.cwd(), "bin", "agentix.js"), "utf8"),
      readFileSync(join(process.cwd(), "bin", "agentix-main.js"), "utf8"),
    ].join("\n");

    expect(cli).toContain('requestedAction === "pause"');
    expect(cli).toContain('requestedAction === "resume"');
    expect(cli).toContain('action === "history"');
    expect(launcher).toContain("pause|resume|set-enabled");
  });
});
