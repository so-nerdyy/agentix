// SandboxAgent - runs generated code in a restricted working directory
// under <dataDir>/sandboxes/<sessionId>/. This is a filesystem boundary with
// a command allowlist and stripped env, not kernel/container isolation.

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { BasePIAgent } from "./BasePIAgent.js";
import { PATHS } from "../config/paths.js";
import type { Task, TaskResult } from "../powerhouse/types.js";

export interface SandboxAgentOpts {
  rootDir?: string;
  /** Wall-clock timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Executables allowed inside the lightweight sandbox runner. */
  allowedCommands?: string[];
}

export class SandboxAgent extends BasePIAgent {
  private readonly rootDir: string;
  private readonly timeoutMs: number;
  private readonly allowedCommands: Set<string>;

  constructor(opts: SandboxAgentOpts = {}) {
    super("sandbox-run");
    this.rootDir = opts.rootDir ?? PATHS.sandboxesDir;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.allowedCommands = new Set([
      ...(opts.allowedCommands ?? ["node"]),
      ...(process.env.AGENTIX_SANDBOX_ALLOWED_COMMANDS ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ]);
  }

  async execute(task: Task): Promise<TaskResult> {
    this.emitStart(task);
    const sandbox = this.ensureSandbox(task.sessionId);

    const payload = task.payload as {
      code?: string;
      filename?: string;
      command?: string[];
    };
    const code = payload.code;
    const filename = payload.filename ?? "snippet.js";
    const command = payload.command ?? ["node", filename];

    if (!code) {
      const err = "SandboxAgent: task.payload.code is required";
      this.emitError(task, err);
      return { ok: false, error: err };
    }

    let filePath: string;
    try {
      this.validateCommand(command);
      filePath = this.resolveSandboxPath(sandbox, filename);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, code, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitError(task, msg);
      return { ok: false, error: msg };
    }

    return new Promise<TaskResult>((resolve) => {
      const child = spawn(command[0], command.slice(1), {
        cwd: sandbox,
        env: {
          PATH: process.env.PATH ?? "",
          NODE_ENV: "test",
          AGENTIX_SANDBOX: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const killTimer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, this.timeoutMs);
      killTimer.unref?.();

      child.stdout?.on("data", (b) => (stdout += b.toString()));
      child.stderr?.on("data", (b) => (stderr += b.toString()));

      child.on("error", (err) => {
        clearTimeout(killTimer);
        const msg = `SandboxAgent spawn error: ${err.message}`;
        this.emitError(task, msg);
        resolve({ ok: false, error: msg });
      });

      child.on("close", (code) => {
        clearTimeout(killTimer);
        const result: TaskResult = timedOut
          ? { ok: false, error: `timeout after ${this.timeoutMs}ms`, output: { stdout, stderr } }
          : code === 0
            ? { ok: true, output: { stdout, stderr, exitCode: code } }
            : { ok: false, error: `exit ${code}`, output: { stdout, stderr, exitCode: code } };
        if (result.ok) this.emitComplete(task, result);
        else this.emitError(task, result.error ?? "sandbox failed");
        resolve(result);
      });
    });
  }

  destroy(sessionId: string): void {
    const sandbox = join(this.rootDir, sessionId);
    if (existsSync(sandbox)) {
      try {
        rmSync(sandbox, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  list(): string[] {
    if (!existsSync(this.rootDir)) return [];
    return readdirSync(this.rootDir);
  }

  override shutdown(): void {
    this.alive = false;
  }

  private ensureSandbox(sessionId: string): string {
    const dir = join(this.rootDir, sessionId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  private resolveSandboxPath(sandbox: string, filename: string): string {
    if (isAbsolute(filename)) {
      throw new Error(`SandboxAgent: filename must be relative to the sandbox: ${filename}`);
    }
    const candidate = resolve(sandbox, filename);
    const rel = relative(sandbox, candidate);
    if (rel.startsWith("..") || isAbsolute(rel) || rel === "") {
      throw new Error(`SandboxAgent: filename escapes sandbox: ${filename}`);
    }
    return candidate;
  }

  private validateCommand(command: string[]): void {
    const executable = command[0];
    if (!executable || isAbsolute(executable) || executable.includes("/") || executable.includes("\\")) {
      throw new Error(`SandboxAgent: executable must be a bare allowed command: ${executable ?? ""}`);
    }
    if (!this.allowedCommands.has(executable)) {
      throw new Error(
        `SandboxAgent: command "${executable}" is not allowed. ` +
        `Allowed commands: ${Array.from(this.allowedCommands).sort().join(", ")}`,
      );
    }
  }
}
