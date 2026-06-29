import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { BasePIAgent } from "./BasePIAgent.js";
import { PATHS } from "../config/paths.js";
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

  async execute(task: Task): Promise<TaskResult> {
    this.emitStart(task);
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
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (result: TaskResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (result.ok) this.emitComplete(task, result);
        else this.emitError(task, result.error ?? "command agent failed");
        resolveResult(result);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish({ ok: false, error: `command Pi agent ${this.id} timed out after ${timeoutMs}ms` });
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (err) => finish({ ok: false, error: err.message }));
      child.on("close", (code) => {
        if (code === 0) {
          finish({ ok: true, output: stdout.trim() || null });
          return;
        }
        finish({ ok: false, error: stderr.trim() || `command exited with ${code}` });
      });
      child.stdin.end(input);
    });
  }
}
