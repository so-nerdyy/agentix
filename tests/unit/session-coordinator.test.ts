import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionCoordinator } from "../../src/powerhouse/SessionCoordinator.js";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "agentix-sessions-"));
}

describe("SessionCoordinator", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists active sessions and recovers them", () => {
    const dir = tempDir();
    dirs.push(dir);

    const coordinator = new SessionCoordinator(dir);
    const session = coordinator.create({ source: "test" });
    coordinator.addPendingTask(session.id, "task-1");

    const sessionPath = join(dir, `${session.id}.json`);
    expect(existsSync(sessionPath)).toBe(true);

    const recovered = new SessionCoordinator(dir).recover();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.id).toBe(session.id);

    const persisted = JSON.parse(readFileSync(sessionPath, "utf-8"));
    expect(persisted.pendingTaskIds).toContain("task-1");
  });

  it("removes completed sessions during recovery", () => {
    const dir = tempDir();
    dirs.push(dir);

    const coordinator = new SessionCoordinator(dir);
    const session = coordinator.create({ source: "test" });
    const sessionPath = join(dir, `${session.id}.json`);

    coordinator.close(session.id);
    expect(existsSync(sessionPath)).toBe(true);

    const recovered = new SessionCoordinator(dir).recover();
    expect(recovered).toHaveLength(0);
    expect(existsSync(sessionPath)).toBe(false);
  });
});
