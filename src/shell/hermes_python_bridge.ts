import { spawn, spawnSync } from "child_process";
import { PATHS } from "../config/paths.js";

export interface PythonCommand {
  command: string;
  args: string[];
}

function pythonCandidates(): PythonCommand[] {
  const configured = process.env.AGENTIX_PYTHON || process.env.PYTHON;
  const candidates: PythonCommand[] = [];
  if (configured) candidates.push({ command: configured, args: [] });
  candidates.push({ command: "python3", args: [] });
  candidates.push({ command: "python", args: [] });
  if (process.platform === "win32") candidates.push({ command: "py", args: ["-3"] });
  return candidates;
}

export function resolvePythonCommand(): PythonCommand {
  for (const candidate of pythonCandidates()) {
    const check = spawnSync(candidate.command, [...candidate.args, "--version"], {
      cwd: PATHS.workspaceRoot,
      stdio: "ignore",
    });
    if (check.status === 0) return candidate;
  }
  throw new Error(
    "Python 3 is required for bundled Agentix compatibility commands. Set AGENTIX_PYTHON to a Python 3 executable if auto-detection fails.",
  );
}

export async function runHermesSubcommand(
  args: string[],
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const python = resolvePythonCommand();
  const child = spawn(python.command, [...python.args, "-m", "hermes_cli.main", ...args], {
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
    spawnError = new Error(`Failed to spawn bundled Agentix compatibility command: ${err.message}`);
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
    throw new Error(`Agentix compatibility command timed out after ${timeoutMs}ms`);
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
