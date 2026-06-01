// CodeAgent — generates and edits code files. Reads an existing file,
// applies a textual modification, and writes it back. Approval must be
// granted by ApprovalWorkflow before execute() is called (CodeAgent
// itself does not require approval — Powerhouse routes `code-edit` tasks
// through the workflow first).
//
// Phase 2 keeps the actual edit logic intentionally simple: a `find` /
// `replace` patch with a `replaceAll` flag, and a `validate` step that
// runs `tsc --noEmit` if `validateTypeScript` is true.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { BasePIAgent } from "./BasePIAgent.js";
import type { Task, TaskResult } from "../powerhouse/types.js";

export interface CodeAgentOpts {
  /** Project root for `tsc --noEmit` validation. */
  projectRoot: string;
}

export class CodeAgent extends BasePIAgent {
  constructor(private readonly opts: CodeAgentOpts) {
    super("code-edit");
  }

  async execute(task: Task): Promise<TaskResult> {
    this.emitStart(task);
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

    const filePath = payload.file;

    try {
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
        const validation = await this.runTsc();
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

  private runTsc(): Promise<TaskResult> {
    return new Promise((resolve) => {
      const child = spawn("npx", ["tsc", "--noEmit"], {
        cwd: this.opts.projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr?.on("data", (b) => (stderr += b.toString()));
      child.on("error", (err) =>
        resolve({ ok: false, error: `tsc spawn error: ${err.message}` }),
      );
      child.on("close", (code) => {
        if (code === 0) resolve({ ok: true, output: { validated: true } });
        else resolve({ ok: false, error: `tsc failed: ${stderr.trim()}` });
      });
    });
  }
}
