import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionCoordinator } from "../../src/powerhouse/SessionCoordinator.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentix-transcript-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("SessionCoordinator transcript", () => {
  it("persists messages and recovers them after restart", () => {
    const dir = tempDir();
    const first = new SessionCoordinator(dir);
    const session = first.create({ source: "shell" });
    first.appendMessage(session.id, { role: "user", content: "continue the plan" });
    first.appendMessage(session.id, { role: "assistant", content: "continuing" });

    const persisted = JSON.parse(readFileSync(join(dir, session.id + ".json"), "utf-8")) as {
      messages: Array<{ role: string; content: string; ts: number }>;
    };
    const restarted = new SessionCoordinator(dir);
    restarted.recover();

    expect(persisted.messages).toHaveLength(2);
    expect(restarted.getMessages(session.id)).toEqual(persisted.messages);
    expect(restarted.getMessages(session.id)[0]).toMatchObject({
      role: "user",
      content: "continue the plan",
    });
  });

  it("recovers legacy files without messages and supports clearing", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "sess-legacy01.json"), JSON.stringify({
      id: "sess-legacy01",
      status: "active",
      createdAt: 1000,
      updatedAt: 1000,
      metadata: { source: "legacy" },
      pendingTaskIds: [],
    }), "utf-8");
    const coordinator = new SessionCoordinator(dir);
    coordinator.recover();

    expect(coordinator.getMessages("sess-legacy01")).toEqual([]);
    expect(coordinator.appendMessage("sess-legacy01", {
      role: "user",
      content: "legacy resumed",
    })).toBeDefined();
    coordinator.clearMessages("sess-legacy01");
    expect(coordinator.getMessages("sess-legacy01")).toEqual([]);
  });

  it("bounds transcript count and message length", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "sess-bounds01.json"), JSON.stringify({
      id: "sess-bounds01",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
      metadata: {},
      pendingTaskIds: [],
      messages: Array.from({ length: 1001 }, (_, index) => ({
        role: "user",
        content: index === 1000 ? "x".repeat(70_000) : "message-" + index,
        ts: index,
      })),
    }), "utf-8");
    const coordinator = new SessionCoordinator(dir);
    coordinator.recover();

    const messages = coordinator.getMessages("sess-bounds01");
    expect(messages).toHaveLength(1000);
    expect(messages[0]?.content).toBe("message-1");
    expect(messages.at(-1)?.content).toHaveLength(64 * 1024);

    coordinator.appendMessage("sess-bounds01", { role: "assistant", content: "newest" });
    const appended = coordinator.getMessages("sess-bounds01");
    expect(appended).toHaveLength(1000);
    expect(appended[0]?.content).toBe("message-2");
    expect(appended.at(-1)?.content).toBe("newest");
  });

  it("ignores malformed and traversal-shaped persisted session ids", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "evil.json"), JSON.stringify({
      id: "../../escaped",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
      metadata: {},
      pendingTaskIds: [],
      messages: [],
    }), "utf-8");
    writeFileSync(join(dir, "malformed.json"), "{not json", "utf-8");

    const coordinator = new SessionCoordinator(dir);
    coordinator.recover();

    expect(coordinator.get("../../escaped")).toBeUndefined();
    expect(coordinator.listRecent()).toEqual([]);
    expect(existsSync(join(dir, "..", "escaped.json"))).toBe(false);
  });
});
