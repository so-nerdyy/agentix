import { createRequire } from "module";
import { startBridge } from "./bridge/server.js";
import { PATHS, ensureDataDirs } from "./config/paths.js";
import { startInboxServer } from "./config/InboxServer.js";
import { buildHelpText } from "./cli/help.js";
import { getBackendRuntime } from "./runtime/backend.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

function readFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0) return undefined;
  const value = args[idx + 1];
  return value && !value.startsWith("-") ? value : undefined;
}

function withoutFlags(args: string[], flags: string[]): string[] {
  const filtered: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (flags.includes(arg)) {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) i += 1;
      continue;
    }
    filtered.push(arg);
  }
  return filtered;
}

async function isBridgeHealthy(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:3456/health");
    return res.ok;
  } catch {
    return false;
  }
}

function formatDoctorReport(report: Record<string, unknown>): string {
  const checks = Array.isArray(report.checks) ? report.checks as Array<Record<string, unknown>> : [];
  const counts = report.counts as Record<string, unknown> | undefined;
  const config = report.config as Record<string, unknown> | undefined;
  return [
    `Agentix doctor: ${String(report.status ?? "unknown").toUpperCase()}`,
    `Workspace: ${String(report.workspace ?? "n/a")}`,
    `Data dir: ${String(report.dataDir ?? "n/a")}`,
    "",
    "Checks:",
    ...checks.map((check) => {
      const status = String(check.status ?? "unknown").toUpperCase().padEnd(4);
      const action = check.action ? `\n      action: ${String(check.action)}` : "";
      return `  [${status}] ${String(check.label ?? check.id ?? "check")}: ${String(check.detail ?? "")}${action}`;
    }),
    "",
    "Counts:",
    `  sessions=${String(counts?.sessions ?? 0)} tasks=${String(counts?.tasks ?? 0)} plans=${String(counts?.plans ?? 0)} approvals=${String(counts?.approvals ?? 0)}`,
    `  jobs=${String(counts?.jobs ?? 0)} gateways=${String(counts?.gateways ?? 0)} memory=${String(counts?.memory ?? 0)} healing=${String(counts?.healingProcedures ?? 0)}`,
    "",
    "Config:",
    `  provider=${String(config?.provider ?? "n/a")} model=${String(config?.model ?? "n/a")} llmKey=${config?.llmApiKeyConfigured ? "configured" : "missing"} sessionToken=${config?.sessionTokenConfigured ? "configured" : "missing"}`,
  ].join("\n");
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const portArg = readFlagValue(args, "--port");
  const hostArg = readFlagValue(args, "--host");
  const bridgePortArg = readFlagValue(args, "--bridge-port");
  const cleanArgs = withoutFlags(args, ["--port", "--host", "--bridge-port"]);

  switch (cmd) {
    case "help":
    case "--help":
    case "-h":
      console.log(buildHelpText(pkg.version));
      return;
    case "version":
    case "--version":
    case "-V":
      console.log(`Agentix v${pkg.version}`);
      return;
    case "server":
      ensureDataDirs();
      await startInboxServer({
        port: portArg ? Number(portArg) : undefined,
        host: hostArg,
      });
      try {
        await startBridge({
          port: bridgePortArg ? Number(bridgePortArg) : undefined,
          host: hostArg,
        });
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes("EADDRINUSE") &&
          (await isBridgeHealthy())
        ) {
          console.error("Bridge already running on 127.0.0.1:3456");
          return;
        }
        throw err;
      }
      return;
    case "dashboard":
    case "ui":
    case "web":
      ensureDataDirs();
      {
        const server = await startInboxServer({
          port: portArg ? Number(portArg) : undefined,
          host: hostArg,
        });
        console.log(`Agentix dashboard available at http://127.0.0.1:${server.port}/ui/`);
      }
      return;
    case "support":
      ensureDataDirs();
      {
        const bundle = getBackendRuntime().createSupportBundle();
        console.log(`Agentix v${pkg.version}`);
        console.log(`Project root: ${PATHS.projectRoot}`);
        console.log(`Hermes root: ${PATHS.hermesRoot}`);
        console.log(`Data dir: ${PATHS.dataDir}`);
        console.log(`Bridge entry: ${PATHS.bridgeEntry}`);
        console.log(`Inbox entry: ${PATHS.inboxEntry}`);
        console.log(`Support bundle: ${(bundle as { bundleDir?: string }).bundleDir ?? "n/a"}`);
      }
      return;
    case "doctor":
      ensureDataDirs();
      {
        const report = getBackendRuntime().doctor();
        if (cleanArgs.includes("--json")) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatDoctorReport(report));
        }
      }
      return;
    case "plans":
      ensureDataDirs();
      for (const plan of getBackendRuntime().listPlans()) {
        console.log(
          `${String(plan.id ?? "")}: ${String(plan.status ?? "")} ${String(plan.planner ?? "")} steps=${String(plan.stepCount ?? 0)} tasks=${String(plan.taskCount ?? 0)} ${String(plan.stimulus ?? "").slice(0, 120)}`,
        );
      }
      return;
    case "plan":
      ensureDataDirs();
      {
        const [planId] = cleanArgs;
        if (!planId) {
          console.log("Usage: agentix --agentix-cli plan <plan-id>");
          return;
        }
        console.log(JSON.stringify(getBackendRuntime().getPlan(planId), null, 2));
      }
      return;
    case "mods":
    case "plugin":
    case "extension":
      ensureDataDirs();
      for (const tool of getBackendRuntime().listTools()) {
        console.log(`${tool.name}: ${tool.description}`);
      }
      return;
    case "gateway":
      ensureDataDirs();
      if (cleanArgs.includes("--help") || cleanArgs.includes("-h")) {
        console.log(buildHelpText(pkg.version));
        return;
      }
      if (!cleanArgs.length) {
        for (const gateway of getBackendRuntime().listGateways()) {
          console.log(
            `${gateway.id}: ${gateway.name} [${gateway.platform}] ${gateway.enabled ? "enabled" : "disabled"} / ${gateway.status}`,
          );
        }
        return;
      }
      {
        const [first, second, ...rest] = cleanArgs;
        if (first === "enable" || first === "disable") {
          const gatewayId = second;
          if (!gatewayId) {
            console.log(`Usage: agentix gateway ${first} <gateway-id>`);
            return;
          }
          console.log(JSON.stringify(getBackendRuntime().setGatewayEnabled(gatewayId, first === "enable"), null, 2));
          return;
        }
        if (first === "message") {
          const gatewayId = second;
          const stimulus = rest.join(" ").trim();
          if (!gatewayId || !stimulus) {
            console.log("Usage: agentix gateway message <gateway-id> <stimulus>");
            return;
          }
          console.log(
            JSON.stringify(
              await getBackendRuntime().receiveGatewayMessage({ gatewayId, stimulus }),
              null,
              2,
            ),
          );
          return;
        }
        if (second === "enable" || second === "disable") {
          console.log(JSON.stringify(getBackendRuntime().setGatewayEnabled(first, second === "enable"), null, 2));
          return;
        }
        if (second === "message") {
          const stimulus = rest.join(" ").trim();
          if (!stimulus) {
            console.log(`Usage: agentix gateway ${first} message <stimulus>`);
            return;
          }
          console.log(
            JSON.stringify(
              await getBackendRuntime().receiveGatewayMessage({ gatewayId: first, stimulus }),
              null,
              2,
            ),
          );
          return;
        }
        console.log(JSON.stringify(getBackendRuntime().getGateway(first), null, 2));
      }
      return;
    case "eval":
    case "broadcast": {
      ensureDataDirs();
      const stimulus = cleanArgs.join(" ").trim();
      if (!stimulus) {
        console.log(`Usage: agentix ${cmd} <stimulus>`);
        return;
      }
      const result = await getBackendRuntime().execute({ stimulus });
      console.log(`Status: ${result.status}`);
      console.log(`Session: ${result.sessionId}`);
      console.log(`Tasks: ${result.taskIds.join(", ") || "(none)"}`);
      if (result.response) {
        console.log("");
        console.log(result.response);
      }
      return;
    }
    case "shell":
      console.log("Use `agentix` with no arguments to open the interactive shell.");
      return;
    case "logs":
      ensureDataDirs();
      for (const entry of getBackendRuntime().listLogs()) {
        const logEntry = entry as {
          timestamp?: string;
          level?: string;
          source?: string;
          message?: string;
        };
        console.log(
          `[${logEntry.timestamp ?? "n/a"}] ${(logEntry.level ?? "info").toUpperCase()} ${(logEntry.source ?? "system")}: ${logEntry.message ?? ""}`,
        );
      }
      return;
    default:
      console.log(buildHelpText(pkg.version));
    }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
