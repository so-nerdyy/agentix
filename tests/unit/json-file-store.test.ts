import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileStore } from "../../src/storage/JsonFileStore.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentix-json-store-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("JsonFileStore", () => {
  it("atomically replaces state without leaving temporary files", () => {
    const dir = tempDir();
    const file = join(dir, "state.json");
    const store = new JsonFileStore(file, { count: 0 });

    store.write({ count: 1 });
    store.update((current) => ({ count: current.count + 1 }));

    expect(store.read()).toEqual({ count: 2 });
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({ count: 2 });
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("returns the fallback for corrupt state without destroying forensic evidence", () => {
    const dir = tempDir();
    const file = join(dir, "state.json");
    writeFileSync(file, "{partial", "utf-8");
    const store = new JsonFileStore(file, { count: 0 });

    expect(store.read()).toEqual({ count: 0 });
    expect(readFileSync(file, "utf-8")).toBe("{partial");
    const backup = readdirSync(dir).find((name) => name.startsWith("state.json.corrupt-"));
    expect(backup).toBeDefined();
    expect(readFileSync(join(dir, backup!), "utf-8")).toBe("{partial");

    store.update((current) => ({ count: current.count + 1 }));
    expect(store.read()).toEqual({ count: 1 });
    expect(readFileSync(join(dir, backup!), "utf-8")).toBe("{partial");
  });
});
