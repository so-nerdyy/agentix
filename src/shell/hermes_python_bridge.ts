// TypeScript bridge to the Python hermes-agent CLI.
// Used by HermesShell slash commands to delegate to real Python implementations.

import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Resolve PROJECT_ROOT from this file's location (src/shell/hermes_python_bridge.ts)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../..");

// Fallback python command
const pythonCmd = "python";

/**
 * Run a hermes-agent subcommand and return its stdout.
 * Times out after `timeoutMs` ms (default 30s).
 */
export async function runHermesSubcommand(
  args: string[],
  opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const pythonExe = pythonCmd;
  const cliPath = resolve(PROJECT_ROOT, "hermes-agent", "cli.py");

  const child = spawn(pythonExe, [cliPath, ...args], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      HERMES_BRIDGE_URL: process.env.HERMES_BRIDGE_URL || "http://127.0.0.1:3456",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let spawnError: Error | null = null;

  child.on("error", (err) => {
    spawnError = new Error(`Failed to spawn python: ${err.message}`);
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);

  // Handle abort signal
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

  if (spawnError) throw spawnError;

  if (timedOut) throw new Error(`Hermes subcommand timed out after ${timeoutMs}ms`);
  if (child.exitCode !== 0 && stderr) throw new Error(stderr.trim());

  return stdout;
}

/**
 * Convenience: run a hermes CLI subcommand and return stdout as string.
 * Throws on non-zero exit or timeout.
 */
export async function hermesCommand(
  subcommand: string,
  args: string[] = [],
  timeoutMs = 30_000
): Promise<string> {
  return runHermesSubcommand([subcommand, ...args], { timeoutMs });
}