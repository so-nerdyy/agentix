import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentix-auth-"));
  dirs.push(dir);
  return dir;
}

describe("HTTP session token auth", () => {
  const envBackup = {
    AGENTIX_DATA_DIR: process.env.AGENTIX_DATA_DIR,
    AGENTIX_SESSION_TOKEN: process.env.AGENTIX_SESSION_TOKEN,
  };

  afterEach(async () => {
    process.env.AGENTIX_DATA_DIR = envBackup.AGENTIX_DATA_DIR;
    process.env.AGENTIX_SESSION_TOKEN = envBackup.AGENTIX_SESSION_TOKEN;
    vi.resetModules();
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  it("protects inbox control APIs while leaving health public", async () => {
    process.env.AGENTIX_DATA_DIR = tempDir();
    process.env.AGENTIX_SESSION_TOKEN = "secret-token";
    const { startInboxServer } = await import("../../src/config/InboxServer.js");
    const server = await startInboxServer({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${server.port}`;

    try {
      expect((await fetch(`${base}/health`)).status).toBe(200);
      expect((await fetch(`${base}/sessions`)).status).toBe(401);
      expect((await fetch(`${base}/sessions`, {
        headers: { Authorization: "Bearer secret-token" },
      })).status).toBe(200);
      expect((await fetch(`${base}/usage`, {
        headers: { Authorization: "Bearer secret-token" },
      })).status).toBe(200);
      expect((await fetch(`${base}/memory`, {
        headers: { Authorization: "Bearer secret-token" },
      })).status).toBe(200);
      const stream = await fetch(`${base}/execute/stream`, {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ stimulus: "inbox stream smoke" }),
      });
      expect(stream.status).toBe(200);
      expect(await stream.text()).toContain("data: [DONE]");
      const reset = await fetch(`${base}/memory/reset`, {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target: "all" }),
      });
      expect(reset.status).toBe(200);
      expect((await reset.json()) as { ok: boolean }).toMatchObject({ ok: true });
    } finally {
      await server.close();
    }
  }, 30_000);

  it("protects bridge control APIs while leaving health public", async () => {
    process.env.AGENTIX_DATA_DIR = tempDir();
    process.env.AGENTIX_SESSION_TOKEN = "bridge-token";
    const { startBridge } = await import("../../src/bridge/server.js");
    const server = await startBridge({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${server.port}`;

    try {
      expect((await fetch(`${base}/health`)).status).toBe(200);
      expect((await fetch(`${base}/sessions`)).status).toBe(401);
      expect((await fetch(`${base}/sessions`, {
        headers: { Authorization: "Bearer bridge-token" },
      })).status).toBe(200);
      expect((await fetch(`${base}/usage`, {
        headers: { Authorization: "Bearer bridge-token" },
      })).status).toBe(200);
    } finally {
      await server.close();
    }
  }, 30_000);
});
