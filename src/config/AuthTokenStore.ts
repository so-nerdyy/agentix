import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { JsonFileStore } from "../storage/JsonFileStore.js";
import { PATHS } from "./paths.js";

export type AuthRole = "viewer" | "operator" | "admin";

export interface StoredAuthToken {
  id: string;
  label: string;
  role: AuthRole;
  prefix: string;
  tokenHash: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

interface AuthTokenFile {
  tokens: StoredAuthToken[];
}

const ROLE_RANK: Record<AuthRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf-8").digest("hex");
}

function hashesEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function normalizeRole(role: unknown): AuthRole {
  return role === "viewer" || role === "operator" || role === "admin"
    ? role
    : "operator";
}

export function roleMeets(role: AuthRole, required: AuthRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export class AuthTokenStore {
  private readonly store: JsonFileStore<AuthTokenFile>;

  constructor(file = PATHS.authTokensFile) {
    this.store = new JsonFileStore(file, { tokens: [] });
  }

  list(includeRevoked = false): Array<Omit<StoredAuthToken, "tokenHash">> {
    return this.store
      .read()
      .tokens
      .filter((token) => includeRevoked || !token.revokedAt)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ tokenHash: _tokenHash, ...safe }) => safe);
  }

  hasActiveTokens(): boolean {
    return this.store.read().tokens.some((token) => !token.revokedAt);
  }

  create(input: { label?: string; role?: AuthRole } = {}): {
    token: string;
    record: Omit<StoredAuthToken, "tokenHash">;
  } {
    const now = Date.now();
    const raw = randomBytes(32).toString("base64url");
    const token = `agx_${raw}`;
    const record: StoredAuthToken = {
      id: `tok_${randomBytes(6).toString("hex")}`,
      label: input.label?.trim() || "workspace token",
      role: normalizeRole(input.role),
      prefix: token.slice(0, 10),
      tokenHash: hashToken(token),
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    };

    this.store.update((current) => ({
      tokens: [...current.tokens, record],
    }));
    const { tokenHash: _tokenHash, ...safe } = record;
    return { token, record: safe };
  }

  authenticate(token: string | null | undefined): {
    ok: boolean;
    role?: AuthRole;
    tokenId?: string;
  } {
    if (!token) return { ok: false };
    const hashed = hashToken(token);
    const matched = this.store.read().tokens.find((stored) =>
      !stored.revokedAt && hashesEqual(stored.tokenHash, hashed),
    );
    if (!matched) return { ok: false };
    const lastUsedAt = Date.now();
    this.store.update((current) => {
      const next = current.tokens.map((stored) => {
        if (stored.id === matched.id) return { ...stored, lastUsedAt };
        return stored;
      });
      return { tokens: next };
    });
    return { ok: true, role: matched.role, tokenId: matched.id };
  }

  revoke(id: string): boolean {
    let revoked = false;
    this.store.update((current) => ({
      tokens: current.tokens.map((token) => {
        if (token.id === id && !token.revokedAt) {
          revoked = true;
          return { ...token, revokedAt: Date.now() };
        }
        return token;
      }),
    }));
    return revoked;
  }
}

export const defaultAuthTokenStore = new AuthTokenStore();
