// BashAgent — runs an approved shell command in the project environment.
// Approval must be granted by ApprovalWorkflow before BashAgent.execute()
// is called. Streams stdout/stderr via EventBus for the UI and event log.

import { spawn } from "node:child_process";
import { BasePIAgent } from "./BasePIAgent.js";
import type { AgentExecutionContext } from "./BasePIAgent.js";
import { terminateProcessTree, USE_DETACHED_PROCESS_GROUP } from "./processControl.js";
import { OutputBuffer, resolveOutputLimit } from "./OutputBuffer.js";
import type { Task, TaskResult } from "../powerhouse/types.js";

export interface BashAgentOpts {
  cwd?: string;
  /** Wall-clock timeout in ms. Default 60s. */
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
}

export class BashAgent extends BasePIAgent {
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly maxOutputBytes: number;

  constructor(opts: BashAgentOpts = {}) {
    super("bash");
    this.cwd = opts.cwd ?? process.cwd();
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.env = opts.env ?? process.env;
    this.maxOutputBytes = resolveOutputLimit(opts.maxOutputBytes);
  }

  async execute(task: Task, context: AgentExecutionContext = {}): Promise<TaskResult> {
    this.emitStart(task);
    if (context.signal?.aborted) return { ok: false, error: "cancelled" };
    const payload = task.payload as {
      command?: string;
      args?: string[];
      commandLine?: string;
    };
    if (!payload.command && !payload.commandLine) {
      const err = "BashAgent: task.payload.command is required";
      this.emitError(task, err);
      return { ok: false, error: err };
    }

    const { command, args } = this.resolveCommand(payload);

    return new Promise<TaskResult>((resolve) => {
      const child = spawn(command, args, {
        cwd: this.cwd,
        env: this.env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        detached: USE_DETACHED_PROCESS_GROUP,
        windowsHide: true,
      });

      const stdout = new OutputBuffer(this.maxOutputBytes);
      const stderr = new OutputBuffer(this.maxOutputBytes);
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      const onAbort = () => {
        cancelled = true;
        terminateProcessTree(child);
      };
      context.signal?.addEventListener("abort", onAbort, { once: true });

      const finish = (result: TaskResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        context.signal?.removeEventListener("abort", onAbort);
        if (result.ok) this.emitComplete(task, result);
        else this.emitError(task, result.error ?? "bash failed");
        resolve(result);
      };

      const killTimer = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child);
      }, this.timeoutMs);
      killTimer.unref?.();

      child.stdout?.on("data", (chunk) => stdout.append(chunk));
      child.stderr?.on("data", (chunk) => stderr.append(chunk));

      child.on("error", (err) => {
        const msg = `BashAgent spawn error: ${err.message}`;
        finish({ ok: false, error: msg });
      });

      child.on("close", (code) => {
        const duration = Date.now() - (task.startedAt ?? Date.now());
        const output = {
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          duration,
          truncated: stdout.truncated || stderr.truncated,
        };
        const result: TaskResult = cancelled
          ? { ok: false, error: "cancelled", output }
          : timedOut
          ? { ok: false, error: `timeout after ${this.timeoutMs}ms`, output }
          : code === 0
            ? { ok: true, output: { ...output, exitCode: code } }
            : { ok: false, error: `exit ${code}`, output: { ...output, exitCode: code } };
        finish(result);
      });
      if (context.signal?.aborted) onAbort();
    });
  }

  override shutdown(): void {
    this.alive = false;
  }

  private resolveCommand(payload: { command?: string; args?: string[]; commandLine?: string }): {
    command: string;
    args: string[];
  } {
    if (!payload.commandLine) {
      return {
        command: payload.command!,
        args: payload.args ?? [],
      };
    }

    if (process.platform === "win32") {
      return {
        command: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", payload.commandLine],
      };
    }

    return {
      command: process.env.SHELL ?? "sh",
      args: ["-lc", payload.commandLine],
    };
  }
}
