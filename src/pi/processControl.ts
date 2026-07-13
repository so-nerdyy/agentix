import { spawn, type ChildProcess } from "node:child_process";

export const USE_DETACHED_PROCESS_GROUP = process.platform !== "win32";

export function terminateProcessTree(child: ChildProcess, force = true): void {
  const pid = child.pid;
  if (!pid || child.exitCode !== null) return;

  if (process.platform === "win32") {
    try {
      const killer = spawn(
        "taskkill",
        ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])],
        { stdio: "ignore", windowsHide: true },
      );
      killer.unref();
      try {
        child.kill(force ? "SIGKILL" : "SIGTERM");
      } catch {
        // taskkill still owns descendant cleanup if the direct child already exited.
      }
      return;
    } catch {
      // Fall through to the direct child signal.
    }
  } else if (USE_DETACHED_PROCESS_GROUP) {
    try {
      process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
      return;
    } catch {
      // The process may not have created a group yet.
    }
  }

  try {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  } catch {
    // The child may already have exited.
  }
}
