import { afterEach, describe, expect, it, vi } from "vitest";
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
    vi.useRealTimers();
    while (dirs.length > 0) {
      const dir = dirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists recent sessions by update time rather than random filename", () => {
    const dir = tempDir();
    dirs.push(dir);
    vi.useFakeTimers();

    vi.setSystemTime(1_000);
    const coordinator = new SessionCoordinator(dir);
    const first = coordinator.create({ source: "first" });
    vi.setSystemTime(2_000);
    const second = coordinator.create({ source: "second" });
    vi.setSystemTime(3_000);
    coordinator.updateMetadata(first.id, { touched: true });

    const recent = new SessionCoordinator(dir).listRecent(2);
    expect(recent.map((session) => session.id)).toEqual([first.id, second.id]);
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

  it("keeps completed sessions as history during recovery", () => {
    const dir = tempDir();
    dirs.push(dir);

    const coordinator = new SessionCoordinator(dir);
    const session = coordinator.create({ source: "test" });
    const sessionPath = join(dir, `${session.id}.json`);

    coordinator.close(session.id);
    expect(existsSync(sessionPath)).toBe(true);

    const nextCoordinator = new SessionCoordinator(dir);
    const recovered = nextCoordinator.recover();
    expect(recovered).toHaveLength(0);
    expect(existsSync(sessionPath)).toBe(true);
    expect(nextCoordinator.list().find((item) => item.id === session.id)?.status).toBe("complete");
    expect(nextCoordinator.listActive()).toHaveLength(0);
  });
});
