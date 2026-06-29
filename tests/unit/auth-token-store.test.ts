import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthTokenStore, roleMeets } from "../../src/config/AuthTokenStore.js";

describe("AuthTokenStore", () => {
  it("creates hashed role tokens, authenticates them, and revokes them", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentix-auth-store-"));
    const file = join(dir, "tokens.json");
    try {
      const store = new AuthTokenStore(file);
      const created = store.create({ role: "operator", label: "test operator" });

      expect(created.token).toMatch(/^agx_/);
      expect(created.record.role).toBe("operator");
      expect(created.record.label).toBe("test operator");
      expect(store.list()).toHaveLength(1);
      expect(JSON.stringify(store.list())).not.toContain(created.token);

      const raw = readFileSync(file, "utf-8");
      expect(raw).toContain("tokenHash");
      expect(raw).not.toContain(created.token);

      expect(store.authenticate(created.token)).toMatchObject({
        ok: true,
        role: "operator",
        tokenId: created.record.id,
      });
      expect(store.authenticate("wrong-token")).toMatchObject({ ok: false });

      expect(store.revoke(created.record.id)).toBe(true);
      expect(store.authenticate(created.token)).toMatchObject({ ok: false });
      expect(store.list()).toHaveLength(0);
      expect(store.list(true)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("orders roles by capability", () => {
    expect(roleMeets("admin", "operator")).toBe(true);
    expect(roleMeets("operator", "viewer")).toBe(true);
    expect(roleMeets("viewer", "operator")).toBe(false);
    expect(roleMeets("operator", "admin")).toBe(false);
  });
});
