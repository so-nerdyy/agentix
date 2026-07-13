import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverGatewayResponse } from "../../src/gateway/GatewayConnector.js";
import type { GatewayRecord } from "../../src/gateway/GatewayRegistry.js";

const previous = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  chat: process.env.TELEGRAM_CHAT_ID,
  timeout: process.env.AGENTIX_GATEWAY_TIMEOUT_MS,
};

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function telegramGateway(): GatewayRecord {
  return {
    id: "telegram",
    platform: "telegram",
    name: "Telegram",
    enabled: true,
    status: "idle",
    endpoint: "https://api.telegram.org",
    tokenConfigured: true,
    messageCount: 0,
    lastSeenAt: null,
    lastError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {},
  };
}

afterEach(() => {
  restore("TELEGRAM_BOT_TOKEN", previous.token);
  restore("TELEGRAM_CHAT_ID", previous.chat);
  restore("AGENTIX_GATEWAY_TIMEOUT_MS", previous.timeout);
  vi.unstubAllGlobals();
});

describe("gateway delivery", () => {
  it("bounds hanging requests without exposing credential-bearing targets", async () => {
    const secret = "telegram-secret-must-not-leak";
    process.env.TELEGRAM_BOT_TOKEN = secret;
    process.env.TELEGRAM_CHAT_ID = "123";
    process.env.AGENTIX_GATEWAY_TIMEOUT_MS = "100";
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })));

    const result = await deliverGatewayResponse(telegramGateway(), "hello");

    expect(result).toMatchObject({
      attempted: true,
      ok: false,
      target: "telegram",
      error: "gateway request timed out after 100ms",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("does not persist an untrusted remote error body", async () => {
    const secret = "remote-error-secret";
    process.env.TELEGRAM_BOT_TOKEN = "configured-token";
    process.env.TELEGRAM_CHAT_ID = "123";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(secret.repeat(100), { status: 500 })));

    const result = await deliverGatewayResponse(telegramGateway(), "hello");

    expect(result).toMatchObject({
      attempted: true,
      ok: false,
      target: "telegram",
      status: 500,
      error: "gateway endpoint returned HTTP 500",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
