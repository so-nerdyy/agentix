// BashAgent — runs an approved shell command in the project environment.
// Approval must be granted by ApprovalWorkflow before BashAgent.execute()
// is called. Streams stdout/stderr via EventBus for the UI and event log.

import { spawn } from "node:child_process";
import { BasePIAgent } from "./BasePIAgent.js";
import type { Task, TaskResult } from "../powerhouse/types.js";

export interface BashAgentOpts {
  cwd?: string;
  /** Wall-clock timeout in ms. Default 60s. */
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export class BashAgent extends BasePIAgent {
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly env: NodeJS.ProcessEnv;

  constructor(opts: BashAgentOpts = {}) {
    super("bash");
    this.cwd = opts.cwd ?? process.cwd();
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.env = opts.env ?? process.env;
  }

  async execute(task: Task): Promise<TaskResult> {
    this.emitStart(task);
    const payload = task.payload as {
      command?: string;
      args?: string[];
    };
    if (!payload.command) {
      const err = "BashAgent: task.payload.command is required";
      this.emitError(task, err);
      return { ok: false, error: err };
    }

    const command = payload.command;
    const args = payload.args ?? [];

    return new Promise<TaskResult>((resolve) => {
      const child = spawn(command, args, {
        cwd: this.cwd,
        env: this.env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
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
        const msg = `BashAgent spawn error: ${err.message}`;
        this.emitError(task, msg);
        resolve({ ok: false, error: msg });
      });

      child.on("close", (code) => {
        clearTimeout(killTimer);
        const duration = Date.now() - (task.startedAt ?? Date.now());
        const result: TaskResult = timedOut
          ? { ok: false, error: `timeout after ${this.timeoutMs}ms`, output: { stdout, stderr, duration } }
          : code === 0
            ? { ok: true, output: { stdout, stderr, exitCode: code, duration } }
            : { ok: false, error: `exit ${code}`, output: { stdout, stderr, exitCode: code, duration } };
        if (result.ok) this.emitComplete(task, result);
        else this.emitError(task, result.error ?? "bash failed");
        resolve(result);
      });
    });
  }

  override shutdown(): void {
    this.alive = false;
  }
}
