// SandboxAgent - runs generated code in a restricted working directory
// under <dataDir>/sandboxes/<sessionId>/. This is a filesystem boundary with
// a command allowlist and stripped env, not kernel/container isolation.

import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { BasePIAgent } from "./BasePIAgent.js";
import type { AgentExecutionContext } from "./BasePIAgent.js";
import { PATHS } from "../config/paths.js";
import { terminateProcessTree, USE_DETACHED_PROCESS_GROUP } from "./processControl.js";
import { OutputBuffer, resolveOutputLimit } from "./OutputBuffer.js";
import type { Task, TaskResult } from "../powerhouse/types.js";

export interface SandboxAgentOpts {
  rootDir?: string;
  /** Wall-clock timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Executables allowed inside the lightweight sandbox runner. */
  allowedCommands?: string[];
  isolationMode?: "auto" | "local" | "docker";
  dockerImage?: string;
  maxOutputBytes?: number;
}

export function buildDockerSandboxArgs(sandbox: string, image: string, command: string[]): string[] {
  return [
    "run",
    "--rm",
    "--network",
    "none",
    "--cpus",
    "1",
    "--memory",
    "256m",
    "--pids-limit",
    "128",
    "-v",
    `${sandbox}:/workspace:rw`,
    "-w",
    "/workspace",
    image,
    ...command,
  ];
}

export function dockerSandboxAvailable(image: string): boolean {
  const daemon = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    stdio: "ignore",
    timeout: 2_000,
  });
  if (daemon.status !== 0) return false;
  const inspected = spawnSync("docker", ["image", "inspect", image], {
    stdio: "ignore",
    timeout: 2_000,
  });
  return inspected.status === 0;
}

export class SandboxAgent extends BasePIAgent {
  private readonly rootDir: string;
  private readonly timeoutMs: number;
  private readonly allowedCommands: Set<string>;
  private readonly isolationMode: "auto" | "local" | "docker";
  private readonly dockerImage: string;
  private readonly maxOutputBytes: number;

  constructor(opts: SandboxAgentOpts = {}) {
    super("sandbox-run");
    this.rootDir = opts.rootDir ?? PATHS.sandboxesDir;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.isolationMode = opts.isolationMode ?? (process.env.AGENTIX_SANDBOX_MODE as "auto" | "local" | "docker" | undefined) ?? "auto";
    this.dockerImage = opts.dockerImage ?? process.env.AGENTIX_SANDBOX_DOCKER_IMAGE ?? "node:22-alpine";
    this.maxOutputBytes = resolveOutputLimit(opts.maxOutputBytes);
    this.allowedCommands = new Set([
      ...(opts.allowedCommands ?? ["node"]),
      ...(process.env.AGENTIX_SANDBOX_ALLOWED_COMMANDS ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ]);
  }

  async execute(task: Task, context: AgentExecutionContext = {}): Promise<TaskResult> {
    this.emitStart(task);
    if (context.signal?.aborted) return { ok: false, error: "cancelled" };
    let sandbox: string;
    try {
      sandbox = this.ensureSandbox(task.sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emitError(task, message);
      return { ok: false, error: message };
    }

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
      this.validateCommand(command, filename);
      filePath = this.resolveSandboxPath(sandbox, filename);
      mkdirSync(dirname(filePath), { recursive: true });
      this.assertRealPathInside(sandbox, dirname(filePath), filename);
      writeFileSync(filePath, code, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitError(task, msg);
      return { ok: false, error: msg };
    }

    const runner = this.resolveRunner(sandbox, command);
    if (!runner.ok) {
      this.emitError(task, runner.error);
      return { ok: false, error: runner.error };
    }

    return new Promise<TaskResult>((resolve) => {
      const child = spawn(runner.command, runner.args, {
        cwd: sandbox,
        env: runner.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: USE_DETACHED_PROCESS_GROUP,
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
        else this.emitError(task, result.error ?? "sandbox failed");
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
        const msg = `SandboxAgent spawn error: ${err.message}`;
        finish({ ok: false, error: msg });
      });

      child.on("close", (code) => {
        const output = {
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          isolation: runner.isolation,
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
    mkdirSync(this.rootDir, { recursive: true });
    const root = realpathSync(this.rootDir);
    const dir = resolve(root, sessionId);
    const rel = relative(root, dir);
    if (rel.startsWith("..") || isAbsolute(rel) || rel === "") {
      throw new Error(`SandboxAgent: session id escapes sandbox root: ${sessionId}`);
    }
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.assertRealPathInside(root, dir, sessionId);
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

  private validateCommand(command: string[], filename: string): void {
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
    if (executable === "node" && command[1] !== filename) {
      throw new Error("SandboxAgent: node command must execute the generated sandbox file");
    }
  }

  private assertRealPathInside(root: string, candidate: string, label: string): void {
    const realRoot = realpathSync(root);
    const realCandidate = realpathSync(candidate);
    const rel = relative(realRoot, realCandidate);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`SandboxAgent: path resolves outside sandbox: ${label}`);
    }
  }

  private resolveRunner(
    sandbox: string,
    command: string[],
  ): { ok: true; command: string; args: string[]; env: NodeJS.ProcessEnv; isolation: "local" | "docker" } | { ok: false; error: string } {
    const dockerAvailable = this.isolationMode !== "local" && this.dockerAvailable();
    if (this.isolationMode === "docker" && !dockerAvailable) {
      return { ok: false, error: "SandboxAgent: Docker isolation requested but docker is not available" };
    }
    if (dockerAvailable) {
      return {
        ok: true,
        command: "docker",
        args: buildDockerSandboxArgs(sandbox, this.dockerImage, command),
        env: {
          PATH: process.env.PATH ?? "",
          AGENTIX_SANDBOX: "1",
          AGENTIX_SANDBOX_ISOLATION: "docker",
        },
        isolation: "docker",
      };
    }
    return {
      ok: true,
      command: command[0]!,
      args: command.slice(1),
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "test",
        AGENTIX_SANDBOX: "1",
        AGENTIX_SANDBOX_ISOLATION: "local",
      },
      isolation: "local",
    };
  }

  private dockerAvailable(): boolean {
    return dockerSandboxAvailable(this.dockerImage);
  }
}
