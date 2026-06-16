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

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on", "enable", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disable", "disabled"].includes(normalized)) return false;
  return undefined;
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
          printJson(report);
        } else {
          console.log(formatDoctorReport(report));
        }
      }
      return;
    case "usage":
      ensureDataDirs();
      printJson(getBackendRuntime().usage());
      return;
    case "config":
      ensureDataDirs();
      {
        const [action = "show", key, ...valueParts] = cleanArgs;
        const runtime = getBackendRuntime();
        if (action === "show" || action === "check") {
          printJson(runtime.config());
          return;
        }
        if (action === "path") {
          const config = runtime.config();
          console.log(String(config.configFile ?? ""));
          return;
        }
        if (action === "set") {
          if (!key || valueParts.length === 0) {
            console.log("Usage: agentix config set <key> <value>");
            return;
          }
          printJson(runtime.setConfigValue(key, valueParts.join(" ")));
          return;
        }
        console.log("Usage: agentix config [show|check|path|set <key> <value>]");
      }
      return;
    case "sessions":
      ensureDataDirs();
      {
        const [action = "list", idOrValue, ...rest] = cleanArgs;
        const runtime = getBackendRuntime();
        if (action === "list") {
          for (const session of runtime.listSessions()) {
            console.log(`${session.id}: created=${session.createdAt}`);
          }
          return;
        }
        if (action === "create") {
          const model = idOrValue || undefined;
          printJson(runtime.createSession(model ? { model } : undefined));
          return;
        }
        if (action === "inspect") {
          if (!idOrValue) {
            console.log("Usage: agentix sessions inspect <session-id>");
            return;
          }
          printJson(runtime.getSession(idOrValue));
          return;
        }
        if (action === "rename") {
          if (!idOrValue || rest.length === 0) {
            console.log("Usage: agentix sessions rename <session-id> <title>");
            return;
          }
          printJson(runtime.renameSession(idOrValue, rest.join(" ")));
          return;
        }
        if (action === "delete") {
          if (!idOrValue) {
            console.log("Usage: agentix sessions delete <session-id>");
            return;
          }
          runtime.deleteSession(idOrValue);
          printJson({ ok: true, deleted: idOrValue });
          return;
        }
        if (action === "prune") {
          printJson(runtime.pruneSessions({ olderThanDays: Number(idOrValue || 90) }));
          return;
        }
        if (action === "optimize") {
          printJson(runtime.optimizeSessions());
          return;
        }
        console.log("Usage: agentix sessions [list|create [model]|inspect <id>|rename <id> <title>|delete <id>|prune [days]|optimize]");
      }
      return;
    case "memory":
      ensureDataDirs();
      {
        const [action = "status", ...memoryArgs] = cleanArgs;
        const runtime = getBackendRuntime();
        if (action === "status") {
          const records = runtime.listMemory();
          const byRole = new Map<string, number>();
          for (const record of records) {
            const role = String(record.role ?? "unknown");
            byRole.set(role, (byRole.get(role) ?? 0) + 1);
          }
          printJson({ records: records.length, byRole: Object.fromEntries(byRole) });
          return;
        }
        if (action === "list") {
          printJson(runtime.listMemory(memoryArgs[0]));
          return;
        }
        if (action === "search") {
          const query = memoryArgs.join(" ").trim();
          if (!query) {
            console.log("Usage: agentix memory search <query>");
            return;
          }
          printJson(runtime.memorySearch(query));
          return;
        }
        if (action === "consolidate") {
          printJson(runtime.consolidateMemory(memoryArgs[0]));
          return;
        }
        if (action === "reset") {
          const [target = "all", sessionId] = memoryArgs;
          printJson(runtime.resetMemory({ target: target as "all" | "memory" | "user", sessionId }));
          return;
        }
        console.log("Usage: agentix memory [status|list [session-id]|search <query>|consolidate [session-id]|reset [all|memory|user] [session-id]]");
      }
      return;
    case "cron":
    case "scheduler":
      ensureDataDirs();
      {
        const [action = "list", idOrName, ...rest] = cleanArgs;
        const runtime = getBackendRuntime();
        if (action === "list") {
          for (const job of runtime.listJobs()) {
            console.log(`${String(job.id ?? "")}: ${String(job.enabled ?? true)} ${String(job.scheduleDisplay ?? job.schedule ?? "")} ${String(job.name ?? "")}`);
          }
          return;
        }
        if (action === "inspect") {
          if (!idOrName) {
            console.log(`Usage: agentix ${cmd} inspect <job-id>`);
            return;
          }
          printJson(runtime.getJob(idOrName));
          return;
        }
        if (action === "create") {
          const stimulus = rest.join(" ").trim();
          if (!idOrName || !stimulus) {
            console.log(`Usage: agentix ${cmd} create <name> <stimulus>`);
            return;
          }
          printJson(runtime.createJob({ name: idOrName, stimulus, schedule: "every 1m", enabled: true }));
          return;
        }
        if (action === "run") {
          if (!idOrName) {
            console.log(`Usage: agentix ${cmd} run <job-id>`);
            return;
          }
          printJson(await runtime.runJob(idOrName));
          return;
        }
        if (action === "run-due") {
          printJson(await runtime.runDueJobs());
          return;
        }
        if (action === "enable" || action === "disable") {
          if (!idOrName) {
            console.log(`Usage: agentix ${cmd} ${action} <job-id>`);
            return;
          }
          printJson(runtime.setJobEnabled(idOrName, action === "enable"));
          return;
        }
        if (action === "delete") {
          if (!idOrName) {
            console.log(`Usage: agentix ${cmd} delete <job-id>`);
            return;
          }
          printJson(runtime.removeJob(idOrName));
          return;
        }
        if (action === "set-enabled") {
          const enabled = parseBoolean(rest[0]);
          if (!idOrName || enabled === undefined) {
            console.log(`Usage: agentix ${cmd} set-enabled <job-id> <true|false>`);
            return;
          }
          printJson(runtime.setJobEnabled(idOrName, enabled));
          return;
        }
        console.log(`Usage: agentix ${cmd} [list|inspect <id>|create <name> <stimulus>|run <id>|run-due|enable <id>|disable <id>|delete <id>]`);
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
    case "tasks":
      ensureDataDirs();
      {
        const [sessionId] = cleanArgs;
        for (const task of getBackendRuntime().listTasks(sessionId)) {
          console.log(
            `${String(task.id ?? "")}: ${String(task.status ?? "")} ${String(task.kind ?? "")} session=${String(task.sessionId ?? "")}`,
          );
        }
      }
      return;
    case "task":
      ensureDataDirs();
      {
        const [taskId, action = "inspect", ...actionArgs] = cleanArgs;
        if (!taskId) {
          console.log("Usage: agentix task <task-id> [inspect|approve|reject|cancel|retry|restart] [reason]");
          return;
        }
        if (action === "inspect") {
          console.log(JSON.stringify(getBackendRuntime().getTask(taskId), null, 2));
          return;
        }
        if (action === "approve") {
          console.log(JSON.stringify(await getBackendRuntime().approve(taskId), null, 2));
          return;
        }
        if (action === "reject") {
          console.log(JSON.stringify(await getBackendRuntime().reject(taskId, actionArgs.join(" ").trim() || undefined), null, 2));
          return;
        }
        if (action === "cancel" || action === "retry" || action === "restart") {
          console.log(JSON.stringify(await getBackendRuntime().controlTask(taskId, action), null, 2));
          return;
        }
        console.log(`Unknown task action: ${action}`);
      }
      return;
    case "approvals":
      ensureDataDirs();
      for (const approval of getBackendRuntime().listApprovals()) {
        console.log(
          `${String(approval.id ?? "")}: ${String(approval.kind ?? "")} session=${String(approval.sessionId ?? "")}`,
        );
      }
      return;
    case "approval":
      ensureDataDirs();
      {
        const [taskId, action = "inspect", ...actionArgs] = cleanArgs;
        if (!taskId) {
          console.log("Usage: agentix approval <task-id> [inspect|approve|reject] [reason]");
          return;
        }
        if (action === "inspect") {
          console.log(JSON.stringify(getBackendRuntime().getApproval(taskId), null, 2));
          return;
        }
        if (action === "approve") {
          console.log(JSON.stringify(await getBackendRuntime().approve(taskId), null, 2));
          return;
        }
        if (action === "reject") {
          console.log(JSON.stringify(await getBackendRuntime().reject(taskId, actionArgs.join(" ").trim() || undefined), null, 2));
          return;
        }
        console.log(`Unknown approval action: ${action}`);
      }
      return;
    case "search":
      ensureDataDirs();
      {
        const query = cleanArgs.join(" ").trim();
        if (!query) {
          console.log("Usage: agentix search <query>");
          return;
        }
        console.log(JSON.stringify(getBackendRuntime().search(query), null, 2));
      }
      return;
    case "audit":
      ensureDataDirs();
      {
        const [auditId] = cleanArgs;
        if (auditId) {
          console.log(JSON.stringify(getBackendRuntime().getAudit(auditId), null, 2));
          return;
        }
        for (const entry of getBackendRuntime().listAudit()) {
          console.log(
            `${String(entry.id ?? "")}: ${String(entry.type ?? "")} actor=${String(entry.actor ?? "")} subject=${String(entry.subjectId ?? "-")}`,
          );
        }
      }
      return;
    case "healing":
      ensureDataDirs();
      {
        const [entryId, action = "inspect"] = cleanArgs;
        if (!entryId) {
          console.log(JSON.stringify(getBackendRuntime().healingStats(), null, 2));
          return;
        }
        if (action === "inspect") {
          console.log(JSON.stringify(getBackendRuntime().getHealingDetail(entryId), null, 2));
          return;
        }
        if (action === "promote") {
          console.log(JSON.stringify(getBackendRuntime().promoteHealingProcedure(entryId), null, 2));
          return;
        }
        if (action === "deprecate") {
          console.log(JSON.stringify(getBackendRuntime().deprecateHealingProcedure(entryId), null, 2));
          return;
        }
        console.log(`Unknown healing action: ${action}`);
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
