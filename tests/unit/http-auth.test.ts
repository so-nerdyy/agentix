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

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe("HTTP session token auth", () => {
  const envBackup = {
    AGENTIX_DATA_DIR: process.env.AGENTIX_DATA_DIR,
    AGENTIX_SESSION_TOKEN: process.env.AGENTIX_SESSION_TOKEN,
    AGENTIX_ALLOW_UNAUTHENTICATED: process.env.AGENTIX_ALLOW_UNAUTHENTICATED,
    AGENTIX_GATEWAY_SECRET: process.env.AGENTIX_GATEWAY_SECRET,
    AGENTIX_ALLOW_UNAUTHENTICATED_GATEWAY: process.env.AGENTIX_ALLOW_UNAUTHENTICATED_GATEWAY,
  };

  afterEach(async () => {
    restoreEnv("AGENTIX_DATA_DIR", envBackup.AGENTIX_DATA_DIR);
    restoreEnv("AGENTIX_SESSION_TOKEN", envBackup.AGENTIX_SESSION_TOKEN);
    restoreEnv("AGENTIX_ALLOW_UNAUTHENTICATED", envBackup.AGENTIX_ALLOW_UNAUTHENTICATED);
    restoreEnv("AGENTIX_GATEWAY_SECRET", envBackup.AGENTIX_GATEWAY_SECRET);
    restoreEnv("AGENTIX_ALLOW_UNAUTHENTICATED_GATEWAY", envBackup.AGENTIX_ALLOW_UNAUTHENTICATED_GATEWAY);
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
      const openapi = await fetch(`${base}/openapi.json`);
      expect(openapi.status).toBe(200);
      expect((await openapi.json()) as Record<string, unknown>).toMatchObject({ openapi: "3.1.0" });
      expect((await fetch(`${base}/sessions`)).status).toBe(401);
      expect((await fetch(`${base}/sessions`, {
        headers: { Authorization: "Bearer secret-token" },
      })).status).toBe(200);
      expect((await fetch(`${base}/usage`, {
        headers: { Authorization: "Bearer secret-token" },
      })).status).toBe(200);
      const config = await fetch(`${base}/config`, {
        headers: { Authorization: "Bearer secret-token" },
      });
      expect(config.status).toBe(200);
      expect((await config.json()) as Record<string, unknown>).not.toHaveProperty("llmApiKey");
      const configUpdate = await fetch(`${base}/config`, {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: "provider", value: "openai" }),
      });
      expect(configUpdate.status).toBe(200);
      expect((await configUpdate.json()) as { ok: boolean }).toMatchObject({ ok: true });
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
      const streamBody = await stream.text();
      expect(streamBody).toContain('"type":"result"');
      expect(streamBody).toMatch(/"sessionId":"sess-[^"]+"/);
      expect(streamBody).toContain("data: [DONE]");
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
      const openapi = await fetch(`${base}/openapi.json`);
      expect(openapi.status).toBe(200);
      expect((await openapi.json()) as Record<string, unknown>).toMatchObject({ openapi: "3.1.0" });
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

  it("supports workspace API tokens with roles", async () => {
    process.env.AGENTIX_DATA_DIR = tempDir();
    process.env.AGENTIX_SESSION_TOKEN = "admin-token";
    const { startBridge } = await import("../../src/bridge/server.js");
    const server = await startBridge({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${server.port}`;

    try {
      const createViewer = await fetch(`${base}/auth/tokens`, {
        method: "POST",
        headers: {
          Authorization: "Bearer admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "viewer", label: "viewer smoke" }),
      });
      expect(createViewer.status).toBe(200);
      const viewer = await createViewer.json() as { token: string; record: { id: string; role: string } };
      expect(viewer.token).toMatch(/^agx_/);
      expect(viewer.record.role).toBe("viewer");

      expect((await fetch(`${base}/sessions`, {
        headers: { Authorization: `Bearer ${viewer.token}` },
      })).status).toBe(200);
      expect((await fetch(`${base}/execute`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${viewer.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ stimulus: "viewer cannot mutate" }),
      })).status).toBe(403);

      const createOperator = await fetch(`${base}/auth/tokens`, {
        method: "POST",
        headers: {
          Authorization: "Bearer admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "operator", label: "operator smoke" }),
      });
      const operator = await createOperator.json() as { token: string; record: { id: string } };
      expect((await fetch(`${base}/execute`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${operator.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ stimulus: "operator can mutate" }),
      })).status).toBe(200);
      expect((await fetch(`${base}/config`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${operator.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: "provider", value: "openai" }),
      })).status).toBe(403);

      const revoked = await fetch(`${base}/auth/tokens/${encodeURIComponent(operator.record.id)}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer admin-token" },
      });
      expect(revoked.status).toBe(200);
      expect((await revoked.json()) as { ok: boolean }).toMatchObject({ ok: true });
    } finally {
      await server.close();
    }
  }, 30_000);

  it("accepts signed gateway inbound webhooks without session auth", async () => {
    process.env.AGENTIX_DATA_DIR = tempDir();
    process.env.AGENTIX_SESSION_TOKEN = "admin-token";
    process.env.AGENTIX_GATEWAY_SECRET = "gateway-secret";
    const { startBridge } = await import("../../src/bridge/server.js");
    const server = await startBridge({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${server.port}`;

    try {
      const enabled = await fetch(`${base}/gateway/webhook/enable`, {
        method: "POST",
        headers: { Authorization: "Bearer admin-token" },
      });
      expect(enabled.status).toBe(200);

      const rejected = await fetch(`${base}/gateway/webhook/inbound`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "blocked" }),
      });
      expect(rejected.status).toBe(403);

      const accepted = await fetch(`${base}/gateway/webhook/inbound`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agentix-Gateway-Secret": "gateway-secret",
        },
        body: JSON.stringify({ text: "signed gateway smoke" }),
      });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toMatchObject({ ok: true, status: "complete" });
    } finally {
      await server.close();
    }
  }, 30_000);

  it("refuses non-loopback control API binds without a session token", async () => {
    process.env.AGENTIX_DATA_DIR = tempDir();
    delete process.env.AGENTIX_SESSION_TOKEN;
    delete process.env.AGENTIX_ALLOW_UNAUTHENTICATED;
    const { startInboxServer } = await import("../../src/config/InboxServer.js");
    const { startBridge } = await import("../../src/bridge/server.js");

    await expect(startInboxServer({ port: 0, host: "0.0.0.0" })).rejects.toThrow("AGENTIX_SESSION_TOKEN");
    await expect(startBridge({ port: 0, host: "0.0.0.0" })).rejects.toThrow("AGENTIX_SESSION_TOKEN");
  });

  it("allows non-loopback bind when a stored workspace token exists", async () => {
    process.env.AGENTIX_DATA_DIR = tempDir();
    delete process.env.AGENTIX_SESSION_TOKEN;
    const { defaultAuthTokenStore } = await import("../../src/config/AuthTokenStore.js");
    defaultAuthTokenStore.create({ role: "admin", label: "bind token" });
    const { startBridge } = await import("../../src/bridge/server.js");
    const server = await startBridge({ port: 0, host: "0.0.0.0" });
    await server.close();
  });
});
