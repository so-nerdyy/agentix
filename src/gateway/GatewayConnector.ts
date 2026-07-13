import type { GatewayRecord } from "./GatewayRegistry.js";
import { timingSafeEqual } from "node:crypto";

export interface GatewayInbound {
  stimulus: string;
  sessionId?: string;
  metadata: Record<string, unknown>;
  challenge?: string;
}

export interface GatewayDelivery {
  attempted: boolean;
  ok: boolean;
  target: string | null;
  status?: number;
  error?: string;
}

function envKey(id: string, suffix: string): string {
  return `AGENTIX_GATEWAY_${id.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_${suffix}`;
}

function readEnv(id: string, suffix: string, fallback?: string): string {
  return process.env[envKey(id, suffix)] || (fallback ? process.env[fallback] : "") || "";
}

export function gatewaySecretConfigured(id: string): boolean {
  return Boolean(readEnv(id, "SECRET", "AGENTIX_GATEWAY_SECRET"));
}

export function verifyGatewaySecret(id: string, provided: string | undefined): boolean {
  const expected = readEnv(id, "SECRET", "AGENTIX_GATEWAY_SECRET");
  if (!expected) return process.env.AGENTIX_ALLOW_UNAUTHENTICATED_GATEWAY === "1";
  if (!provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

export function gatewayTokenConfigured(gateway: GatewayRecord): boolean {
  if (gateway.platform === "webhook") {
    return Boolean(readEnv(gateway.id, "WEBHOOK_URL", "AGENTIX_GATEWAY_WEBHOOK_URL"));
  }
  if (gateway.platform === "slack") {
    return Boolean(readEnv(gateway.id, "SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN"));
  }
  if (gateway.platform === "discord") {
    return Boolean(readEnv(gateway.id, "DISCORD_WEBHOOK_URL", "DISCORD_WEBHOOK_URL"));
  }
  if (gateway.platform === "teams") {
    return Boolean(readEnv(gateway.id, "TEAMS_WEBHOOK_URL", "TEAMS_WEBHOOK_URL"));
  }
  if (gateway.platform === "telegram") {
    return Boolean(readEnv(gateway.id, "TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_TOKEN"));
  }
  return false;
}

export function parseGatewayInbound(gateway: GatewayRecord, body: Record<string, unknown>): GatewayInbound {
  if (typeof body.challenge === "string") {
    return { stimulus: body.challenge, metadata: { raw: body }, challenge: body.challenge };
  }

  if (gateway.platform === "slack") {
    const event = body.event && typeof body.event === "object" ? body.event as Record<string, unknown> : {};
    return {
      stimulus: String(event.text ?? body.text ?? body.stimulus ?? ""),
      sessionId: String(event.channel ?? body.channel ?? "") || undefined,
      metadata: { raw: body, user: event.user, channel: event.channel },
    };
  }

  if (gateway.platform === "telegram") {
    const message = body.message && typeof body.message === "object" ? body.message as Record<string, unknown> : {};
    const chat = message.chat && typeof message.chat === "object" ? message.chat as Record<string, unknown> : {};
    return {
      stimulus: String(message.text ?? body.text ?? body.stimulus ?? ""),
      sessionId: chat.id === undefined ? undefined : String(chat.id),
      metadata: { raw: body, chatId: chat.id, messageId: message.message_id },
    };
  }

  if (gateway.platform === "discord") {
    return {
      stimulus: String(body.content ?? body.text ?? body.stimulus ?? ""),
      sessionId: String(body.channel_id ?? "") || undefined,
      metadata: { raw: body, author: body.author, channelId: body.channel_id },
    };
  }

  if (gateway.platform === "teams") {
    const conversation = body.conversation && typeof body.conversation === "object"
      ? body.conversation as Record<string, unknown>
      : {};
    return {
      stimulus: String(body.text ?? body.summary ?? body.stimulus ?? ""),
      sessionId: String(body.conversationId ?? conversation.id ?? "") || undefined,
      metadata: { raw: body },
    };
  }

  return {
    stimulus: String(body.stimulus ?? body.text ?? body.message ?? ""),
    sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
    metadata: (body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : { raw: body }),
  };
}

export async function deliverGatewayResponse(gateway: GatewayRecord, response: string, metadata: Record<string, unknown> = {}): Promise<GatewayDelivery> {
  const text = response.slice(0, 3900);
  if (gateway.platform === "slack") {
    const token = readEnv(gateway.id, "SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN");
    const channel = String(metadata.channel ?? readEnv(gateway.id, "SLACK_CHANNEL_ID", "SLACK_CHANNEL_ID"));
    if (!token || !channel) return { attempted: false, ok: false, target: "slack", error: "missing Slack token/channel" };
    return postJson("https://slack.com/api/chat.postMessage", { channel, text }, { Authorization: `Bearer ${token}` }, "slack");
  }

  if (gateway.platform === "discord") {
    const url = readEnv(gateway.id, "DISCORD_WEBHOOK_URL", "DISCORD_WEBHOOK_URL");
    if (!url) return { attempted: false, ok: false, target: "discord", error: "missing Discord webhook URL" };
    return postJson(url, { content: text }, {}, "discord");
  }

  if (gateway.platform === "teams") {
    const url = readEnv(gateway.id, "TEAMS_WEBHOOK_URL", "TEAMS_WEBHOOK_URL");
    if (!url) return { attempted: false, ok: false, target: "teams", error: "missing Teams webhook URL" };
    return postJson(url, { text }, {}, "teams");
  }

  if (gateway.platform === "telegram") {
    const token = readEnv(gateway.id, "TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_TOKEN");
    const chatId = String(metadata.chatId ?? readEnv(gateway.id, "TELEGRAM_CHAT_ID", "TELEGRAM_CHAT_ID"));
    if (!token || !chatId) return { attempted: false, ok: false, target: "telegram", error: "missing Telegram token/chat" };
    return postJson(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text }, {}, "telegram");
  }

  const url = readEnv(gateway.id, "WEBHOOK_URL", "AGENTIX_GATEWAY_WEBHOOK_URL");
  if (!url) return { attempted: false, ok: false, target: "webhook", error: "missing outbound webhook URL" };
  return postJson(url, { gatewayId: gateway.id, response: text, metadata }, {}, "webhook");
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  target = "gateway",
): Promise<GatewayDelivery> {
  const configuredTimeout = Number(process.env.AGENTIX_GATEWAY_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(120_000, Math.max(100, configuredTimeout))
    : 15_000;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`gateway request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  timeout.unref?.();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    await res.body?.cancel().catch(() => undefined);
    return {
      attempted: true,
      ok: res.ok,
      target,
      status: res.status,
      ...(res.ok ? {} : { error: `gateway endpoint returned HTTP ${res.status}` }),
    };
  } catch {
    return {
      attempted: true,
      ok: false,
      target,
      error: timedOut
        ? `gateway request timed out after ${timeoutMs}ms`
        : "gateway delivery request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}
