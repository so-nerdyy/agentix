import { spawn } from "child_process";
import { PATHS } from "../config/paths.js";

const PYTHON_CMD = "python";

export async function runHermesSubcommand(
  args: string[],
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const child = spawn(PYTHON_CMD, ["-m", "hermes_cli.main", ...args], {
    cwd: PATHS.workspaceRoot,
    env: {
      ...process.env,
      PYTHONPATH: PATHS.hermesRoot,
      AGENTIX_FRONTEND: "hermes",
      AGENTIX_INSTALL_ROOT: PATHS.installRoot,
      AGENTIX_WORKSPACE_DIR: PATHS.workspaceRoot,
      AGENTIX_BRIDGE_URL:
        process.env.AGENTIX_BRIDGE_URL || "http://127.0.0.1:3456",
      HERMES_BRIDGE_URL:
        process.env.HERMES_BRIDGE_URL || "http://127.0.0.1:3456",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let spawnError: Error | null = null;

  child.on("error", (err) => {
    spawnError = new Error(`Failed to spawn Hermes CLI: ${err.message}`);
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);

  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      child.kill();
    });
  }

  try {
    for await (const chunk of child.stdout!) {
      stdout += new TextDecoder().decode(chunk);
    }
    for await (const chunk of child.stderr!) {
      stderr += new TextDecoder().decode(chunk);
    }
    await new Promise<void>((resolve) => child.on("close", resolve));
  } finally {
    clearTimeout(timeout);
  }

  if (spawnError) {
    throw spawnError;
  }
  if (timedOut) {
    throw new Error(`Hermes subcommand timed out after ${timeoutMs}ms`);
  }
  if (child.exitCode !== 0 && stderr.trim()) {
    throw new Error(stderr.trim());
  }

  return stdout;
}

export async function hermesCommand(
  subcommand: string,
  args: string[] = [],
  timeoutMs = 30_000,
): Promise<string> {
  return runHermesSubcommand([subcommand, ...args], { timeoutMs });
}
