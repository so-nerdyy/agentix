// CodeAgent — generates and edits code files. Reads an existing file,
// applies a textual modification, and writes it back. Approval must be
// granted by ApprovalWorkflow before execute() is called (CodeAgent
// itself does not require approval — Powerhouse routes `code-edit` tasks
// through the workflow first).
//
// The edit logic stays intentionally simple: a `find` / `replace` patch with
// a `replaceAll` flag, and an optional `tsc --noEmit` validation step.

import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { BasePIAgent } from "./BasePIAgent.js";
import type { AgentExecutionContext } from "./BasePIAgent.js";
import { terminateProcessTree, USE_DETACHED_PROCESS_GROUP } from "./processControl.js";
import { OutputBuffer, resolveOutputLimit } from "./OutputBuffer.js";
import type { Task, TaskResult } from "../powerhouse/types.js";

export interface CodeAgentOpts {
  /** Project root for `tsc --noEmit` validation. */
  projectRoot: string;
  validationTimeoutMs?: number;
  validationCommand?: string[];
}

export class CodeAgent extends BasePIAgent {
  private readonly projectRoot: string;
  private readonly validationTimeoutMs: number;
  private readonly validationCommand: string[];

  constructor(private readonly opts: CodeAgentOpts) {
    super("code-edit");
    this.projectRoot = realpathSync(resolve(opts.projectRoot));
    this.validationTimeoutMs = Math.min(10 * 60_000, Math.max(100, opts.validationTimeoutMs ?? 60_000));
    this.validationCommand = opts.validationCommand ?? ["npx", "tsc", "--noEmit"];
  }

  async execute(task: Task, context: AgentExecutionContext = {}): Promise<TaskResult> {
    this.emitStart(task);
    if (context.signal?.aborted) return { ok: false, error: "cancelled" };
    const payload = task.payload as {
      file?: string;
      find?: string;
      replace?: string;
      replaceAll?: boolean;
      newContent?: string;
      validateTypeScript?: boolean;
    };

    if (!payload.file) {
      const err = "CodeAgent: task.payload.file is required";
      this.emitError(task, err);
      return { ok: false, error: err };
    }

    try {
      const filePath = this.resolveWorkspacePath(payload.file);
      if (payload.newContent !== undefined) {
        writeFileSync(filePath, payload.newContent, "utf-8");
      } else if (payload.find !== undefined && payload.replace !== undefined) {
        if (!existsSync(filePath)) {
          const err = `CodeAgent: file not found: ${filePath}`;
          this.emitError(task, err);
          return { ok: false, error: err };
        }
        const original = readFileSync(filePath, "utf-8");
        const updated = payload.replaceAll
          ? original.split(payload.find).join(payload.replace)
          : original.replace(payload.find, payload.replace);
        writeFileSync(filePath, updated, "utf-8");
      } else {
        const err = "CodeAgent: provide either newContent or find+replace";
        this.emitError(task, err);
        return { ok: false, error: err };
      }

      if (payload.validateTypeScript) {
        const validation = await this.runTsc(context.signal);
        if (!validation.ok) {
          this.emitError(task, validation.error ?? "tsc failed");
          return validation;
        }
        return { ok: true, output: { file: filePath, validated: true } };
      }

      const result: TaskResult = { ok: true, output: { file: filePath } };
      this.emitComplete(task, result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitError(task, msg);
      return { ok: false, error: msg };
    }
  }

  override shutdown(): void {
    this.alive = false;
  }

  private runTsc(signal?: AbortSignal): Promise<TaskResult> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve({ ok: false, error: "cancelled" });
        return;
      }
      const [command, ...args] = this.validationCommand;
      if (!command) {
        resolve({ ok: false, error: "CodeAgent: validation command is empty" });
        return;
      }
      const child = spawn(command, args, {
        cwd: this.projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        detached: USE_DETACHED_PROCESS_GROUP,
        windowsHide: true,
      });
      const outputLimit = resolveOutputLimit();
      const stdout = new OutputBuffer(outputLimit);
      const stderr = new OutputBuffer(outputLimit);
      let settled = false;
      let cancelled = false;
      let timedOut = false;
      const finish = (result: TaskResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = () => {
        cancelled = true;
        terminateProcessTree(child);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child);
      }, this.validationTimeoutMs);
      timer.unref?.();
      child.stdout?.on("data", (chunk) => stdout.append(chunk));
      child.stderr?.on("data", (chunk) => stderr.append(chunk));
      child.on("error", (err) =>
        finish({ ok: false, error: `tsc spawn error: ${err.message}` }),
      );
      child.on("close", (code) => {
        if (cancelled) finish({ ok: false, error: "cancelled" });
        else if (timedOut) finish({
          ok: false,
          error: `tsc validation timed out after ${this.validationTimeoutMs}ms`,
          output: {
            stdout: stdout.toString().trim(),
            stderr: stderr.toString().trim(),
            truncated: stdout.truncated || stderr.truncated,
          },
        });
        else if (code === 0) finish({ ok: true, output: { validated: true } });
        else finish({
          ok: false,
          error: `tsc failed: ${stderr.toString().trim() || stdout.toString().trim() || `exit ${code}`}`,
          output: { truncated: stdout.truncated || stderr.truncated },
        });
      });
      if (signal?.aborted) onAbort();
    });
  }

  private resolveWorkspacePath(file: string): string {
    const candidate = isAbsolute(file) ? resolve(file) : resolve(this.projectRoot, file);
    const rel = relative(this.projectRoot, candidate);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`CodeAgent: file is outside project root: ${file}`);
    }
    const realAnchor = realpathSync(existsSync(candidate) ? candidate : dirname(candidate));
    const realRelative = relative(this.projectRoot, realAnchor);
    if (realRelative.startsWith("..") || isAbsolute(realRelative)) {
      throw new Error(`CodeAgent: file resolves outside project root: ${file}`);
    }
    return candidate;
  }
}
