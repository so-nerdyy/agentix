import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PATHS } from "../config/paths.js";

export type MemoryRole = "user" | "assistant" | "system";

export interface MemoryRecord {
  id: string;
  sessionId: string;
  taskId?: string;
  role: MemoryRole;
  content: string;
  createdAt: number;
  tags: string[];
}

export class MemoryStore {
  private readonly file: string;
  private loaded = false;
  private readonly records: MemoryRecord[] = [];

  constructor(file = join(PATHS.dataDir, "memory", "memory.jsonl")) {
    this.file = file;
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  add(record: Omit<MemoryRecord, "id" | "createdAt">): MemoryRecord {
    this.ensureLoaded();
    const next: MemoryRecord = {
      ...record,
      id: `mem-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: Date.now(),
    };
    this.records.push(next);
    appendFileSync(this.file, `${JSON.stringify(next)}\n`, "utf-8");
    return next;
  }

  search(query: string, limit = 10): Array<{ content: string; score: number }> {
    this.ensureLoaded();
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    return this.records
      .map((record) => ({ record, score: this.score(record, needle) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.record.createdAt - a.record.createdAt)
      .slice(0, limit)
      .map(({ record, score }) => ({
        content: `[${record.role}] ${record.content}`,
        score,
      }));
  }

  list(sessionId?: string): MemoryRecord[] {
    this.ensureLoaded();
    return sessionId
      ? this.records.filter((record) => record.sessionId === sessionId)
      : [...this.records];
  }

  consolidate(sessionId?: string): MemoryRecord {
    const records = this.list(sessionId);
    const recent = records.slice(-20);
    const summary = recent.length === 0
      ? "No memory records available for consolidation."
      : [
          `Consolidated ${recent.length} memory records.`,
          ...recent.map((record) => `${record.role}: ${record.content.slice(0, 180)}`),
        ].join("\n");

    return this.add({
      sessionId: sessionId ?? "global",
      role: "system",
      content: summary,
      tags: ["consolidated"],
    });
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.file)) {
      writeFileSync(this.file, "", "utf-8");
      return;
    }

    const raw = readFileSync(this.file, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        this.records.push(JSON.parse(line) as MemoryRecord);
      } catch {
        // Leave corrupt records on disk but do not load them.
      }
    }
  }

  private score(record: MemoryRecord, needle: string): number {
    const content = record.content.toLowerCase();
    if (content.includes(needle)) return 1;
    const terms = needle.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return 0;
    const hits = terms.filter((term) => content.includes(term)).length;
    return hits / terms.length;
  }
}
