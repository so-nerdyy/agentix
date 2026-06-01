// SandboxAgent — runs untrusted code in an isolated working directory
// under <dataDir>/sandboxes/<sessionId>/. No network, no escape outside
// the sandbox. Used for running generated code, tests, etc.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { BasePIAgent } from "./BasePIAgent.js";
import { PATHS } from "../config/paths.js";
import type { Task, TaskResult } from "../powerhouse/types.js";

export interface SandboxAgentOpts {
  rootDir?: string;
  /** Wall-clock timeout in ms. Default 30s. */
  timeoutMs?: number;
}

export class SandboxAgent extends BasePIAgent {
  private readonly rootDir: string;
  private readonly timeoutMs: number;

  constructor(opts: SandboxAgentOpts = {}) {
    super("sandbox-run");
    this.rootDir = opts.rootDir ?? PATHS.sandboxesDir;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
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

    const filePath = join(sandbox, filename);
    writeFileSync(filePath, code, "utf-8");

    return new Promise<TaskResult>((resolve) => {
      const child = spawn(command[0], command.slice(1), {
        cwd: sandbox,
        env: { PATH: process.env.PATH ?? "" },
        stdio: ["ignore", "pipe", "pipe"],
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
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
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
}
