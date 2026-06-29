import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PATHS } from "../config/paths.js";
import { JsonFileStore } from "../storage/JsonFileStore.js";

export type GatewayPlatform = "slack" | "teams" | "discord" | "telegram" | "webhook";
export type GatewayStatus = "offline" | "idle" | "connected" | "error";

export interface GatewayRecord {
  id: string;
  platform: GatewayPlatform;
  name: string;
  enabled: boolean;
  status: GatewayStatus;
  endpoint: string | null;
  tokenConfigured: boolean;
  messageCount: number;
  lastSeenAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

interface GatewayStoreFile {
  gateways: GatewayRecord[];
}

const DEFAULT_GATEWAYS: Array<Pick<GatewayRecord, "id" | "platform" | "name" | "endpoint" | "metadata">> = [
  {
    id: "slack",
    platform: "slack",
    name: "Slack",
    endpoint: "https://slack.com/api",
    metadata: { description: "Slack workspace gateway" },
  },
  {
    id: "teams",
    platform: "teams",
    name: "Microsoft Teams",
    endpoint: "https://graph.microsoft.com",
    metadata: { description: "Teams chat gateway" },
  },
  {
    id: "discord",
    platform: "discord",
    name: "Discord",
    endpoint: "https://discord.com/api",
    metadata: { description: "Discord server gateway" },
  },
  {
    id: "telegram",
    platform: "telegram",
    name: "Telegram",
    endpoint: "https://api.telegram.org",
    metadata: { description: "Telegram bot gateway" },
  },
  {
    id: "webhook",
    platform: "webhook",
    name: "Webhook",
    endpoint: null,
    metadata: { description: "Generic inbound webhook gateway" },
  },
];

export class GatewayRegistry {
  private readonly store: JsonFileStore<GatewayStoreFile>;

  constructor(file = join(PATHS.dataDir, "gateways", "gateways.json")) {
    this.store = new JsonFileStore(file, { gateways: [] });
    this.ensureDefaults();
  }

  list(): GatewayRecord[] {
    return this.store.read().gateways.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): GatewayRecord | undefined {
    return this.list().find((gateway) => gateway.id === id);
  }

  upsert(input: Partial<GatewayRecord> & { id: string; platform?: GatewayPlatform; name?: string }): GatewayRecord {
    const current = this.store.read();
    const now = Date.now();
    let record: GatewayRecord | undefined;
    const gateways = current.gateways.map((gateway) => {
      if (gateway.id !== input.id) return gateway;
      record = {
        ...gateway,
        ...input,
        platform: (input.platform ?? gateway.platform) as GatewayPlatform,
        name: input.name ?? gateway.name,
        updatedAt: now,
      };
      return record;
    });

    if (!record) {
      record = {
        id: input.id,
        platform: (input.platform ?? "webhook") as GatewayPlatform,
        name: input.name ?? input.id,
        enabled: input.enabled ?? false,
        status: input.status ?? "offline",
        endpoint: input.endpoint ?? null,
        tokenConfigured: input.tokenConfigured ?? false,
        messageCount: input.messageCount ?? 0,
        lastSeenAt: input.lastSeenAt ?? null,
        lastError: input.lastError ?? null,
        createdAt: now,
        updatedAt: now,
        metadata: input.metadata ?? {},
      };
      gateways.push(record);
    }

    this.store.write({ gateways });
    return record;
  }

  setEnabled(id: string, enabled: boolean): GatewayRecord {
    const existing = this.get(id) ?? this.seedFromDefaults(id);
    const next: GatewayRecord = {
      ...existing,
      enabled,
      status: enabled ? "idle" : "offline",
      updatedAt: Date.now(),
    };
    this.store.update((current) => ({
      gateways: current.gateways
        .filter((gateway) => gateway.id !== id)
        .concat(next),
    }));
    return next;
  }

  recordMessage(id: string, input: { status?: GatewayStatus; error?: string | null }): GatewayRecord {
    const existing = this.get(id) ?? this.seedFromDefaults(id);
    const next: GatewayRecord = {
      ...existing,
      status: input.status ?? "connected",
      lastSeenAt: Date.now(),
      lastError: input.error ?? null,
      messageCount: existing.messageCount + 1,
      updatedAt: Date.now(),
    };
    this.store.update((current) => ({
      gateways: current.gateways
        .filter((gateway) => gateway.id !== id)
        .concat(next),
    }));
    return next;
  }

  touch(id: string, patch: Partial<GatewayRecord>): GatewayRecord {
    const existing = this.get(id) ?? this.seedFromDefaults(id);
    const next: GatewayRecord = {
      ...existing,
      ...patch,
      updatedAt: Date.now(),
    };
    this.store.update((current) => ({
      gateways: current.gateways
        .filter((gateway) => gateway.id !== id)
        .concat(next),
    }));
    return next;
  }

  private ensureDefaults(): void {
    const current = this.store.read();
    const now = Date.now();
    const existingIds = new Set(current.gateways.map((gateway) => gateway.id));
    const defaults = DEFAULT_GATEWAYS.filter((gateway) => !existingIds.has(gateway.id)).map((gateway) => ({
        ...gateway,
        enabled: false,
        status: "offline" as GatewayStatus,
        tokenConfigured: false,
        messageCount: 0,
        lastSeenAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      }));
    if (defaults.length === 0 && current.gateways.length > 0) return;
    this.store.write({
      gateways: [...current.gateways, ...defaults],
    });
  }

  private seedFromDefaults(id: string): GatewayRecord {
    const preset = DEFAULT_GATEWAYS.find((gateway) => gateway.id === id);
    const now = Date.now();
    return {
      id,
      platform: preset?.platform ?? "webhook",
      name: preset?.name ?? id,
      enabled: false,
      status: "offline",
      endpoint: preset?.endpoint ?? null,
      tokenConfigured: false,
      messageCount: 0,
      lastSeenAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      metadata: preset?.metadata ?? {},
    };
  }
}

export function createGatewayId(platform: GatewayPlatform): string {
  return `${platform}-${randomUUID().slice(0, 8)}`;
}
