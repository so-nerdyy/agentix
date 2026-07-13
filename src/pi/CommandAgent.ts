import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { BasePIAgent } from "./BasePIAgent.js";
import type { AgentExecutionContext } from "./BasePIAgent.js";
import { PATHS } from "../config/paths.js";
import { terminateProcessTree, USE_DETACHED_PROCESS_GROUP } from "./processControl.js";
import { OutputBuffer, resolveOutputLimit } from "./OutputBuffer.js";
import type { Task, TaskResult } from "../powerhouse/types.js";
import type { CommandAgentProfile } from "./AgentProfileStore.js";

function safeEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    AGENTIX_WORKSPACE_DIR: PATHS.workspaceRoot,
    AGENTIX_DATA_DIR: PATHS.dataDir,
  };
}

export class CommandAgent extends BasePIAgent {
  readonly profile: CommandAgentProfile;

  constructor(profile: CommandAgentProfile) {
    super(profile.kind, profile.id);
    this.profile = profile;
  }

  async execute(task: Task, context: AgentExecutionContext = {}): Promise<TaskResult> {
    this.emitStart(task);
    if (context.signal?.aborted) return { ok: false, error: "cancelled" };
    if (!task.requiresApproval) {
      const error = `command Pi agent ${this.id} requires approval`;
      this.emitError(task, error);
      return { ok: false, error };
    }

    const [command, ...args] = this.profile.command;
    if (!command) {
      const error = `command Pi agent ${this.id} has no command`;
      this.emitError(task, error);
      return { ok: false, error };
    }

    const cwd = this.profile.cwd ? resolve(PATHS.workspaceRoot, this.profile.cwd) : PATHS.workspaceRoot;
    const timeoutMs = this.profile.timeoutMs ?? 60_000;
    const input = JSON.stringify({
      taskId: task.id,
      sessionId: task.sessionId,
      kind: task.kind,
      payload: task.payload,
    });

    return await new Promise<TaskResult>((resolveResult) => {
      const child = spawn(command, args, {
        cwd,
        env: safeEnv(),
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        detached: USE_DETACHED_PROCESS_GROUP,
        windowsHide: true,
      });
      const maxOutputBytes = resolveOutputLimit();
      const stdout = new OutputBuffer(maxOutputBytes);
      const stderr = new OutputBuffer(maxOutputBytes);
      let settled = false;
      let cancelled = false;
      const onAbort = () => {
        cancelled = true;
        terminateProcessTree(child);
      };
      context.signal?.addEventListener("abort", onAbort, { once: true });
      const finish = (result: TaskResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context.signal?.removeEventListener("abort", onAbort);
        if (result.ok) this.emitComplete(task, result);
        else this.emitError(task, result.error ?? "command agent failed");
        resolveResult(result);
      };
      const timer = setTimeout(() => {
        terminateProcessTree(child);
        finish({
          ok: false,
          error: `command Pi agent ${this.id} timed out after ${timeoutMs}ms`,
          output: {
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            truncated: stdout.truncated || stderr.truncated,
          },
        });
      }, timeoutMs);
      timer.unref?.();

      child.stdout.on("data", (chunk) => {
        stdout.append(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr.append(chunk);
      });
      child.on("error", (err) => finish({ ok: false, error: err.message }));
      child.on("close", (code) => {
        if (cancelled) {
          finish({ ok: false, error: "cancelled" });
          return;
        }
        if (code === 0) {
          const stdoutText = stdout.toString().trim();
          const truncated = stdout.truncated || stderr.truncated;
          finish({
            ok: true,
            output: truncated
              ? `${stdoutText}${stdoutText ? "\n" : ""}[output truncated]`
              : stdoutText || null,
          });
          return;
        }
        finish({
          ok: false,
          error: stderr.toString().trim() || `command exited with ${code}`,
          output: {
            stdout: stdout.toString().trim(),
            stderr: stderr.toString().trim(),
            truncated: stdout.truncated || stderr.truncated,
          },
        });
      });
      if (context.signal?.aborted) onAbort();
      else child.stdin.end(input);
    });
  }
}
