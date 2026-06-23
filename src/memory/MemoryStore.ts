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

export interface MemorySearchResult {
  id: string;
  sessionId: string;
  taskId: string | null;
  role: MemoryRole;
  content: string;
  score: number;
  tags: string[];
  createdAt: number;
}

const SYNONYMS: Record<string, string[]> = {
  car: ["vehicle", "auto", "automobile"],
  vehicle: ["car", "auto", "automobile"],
  price: ["cost", "pricing", "fee", "rate"],
  pricing: ["price", "cost", "fee", "rate"],
  cost: ["price", "pricing", "fee", "rate"],
  error: ["failure", "bug", "exception", "crash"],
  failure: ["error", "bug", "exception", "crash"],
  task: ["job", "work", "step"],
  job: ["task", "work", "step"],
  schedule: ["cron", "timer", "interval"],
  cron: ["schedule", "timer", "interval"],
  auth: ["authentication", "token", "credential"],
  token: ["auth", "authentication", "credential"],
};

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

  search(query: string, limit = 10): MemorySearchResult[] {
    this.ensureLoaded();
    const queryProfile = textProfile(query);
    if (queryProfile.tokens.size === 0) return [];

    return this.records
      .map((record) => ({ record, score: this.score(record, query, queryProfile) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.record.createdAt - a.record.createdAt)
      .slice(0, limit)
      .map(({ record, score }) => ({
        id: record.id,
        sessionId: record.sessionId,
        taskId: record.taskId ?? null,
        role: record.role,
        content: `[${record.role}] ${record.content}`,
        score: Number(score.toFixed(4)),
        tags: record.tags,
        createdAt: record.createdAt,
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

  reset(input: { sessionId?: string; roles?: MemoryRole[] } = {}): { removed: number; remaining: number } {
    this.ensureLoaded();
    const roles = input.roles?.length ? new Set(input.roles) : null;
    const kept = this.records.filter((record) => {
      const sessionMatches = !input.sessionId || record.sessionId === input.sessionId;
      const roleMatches = !roles || roles.has(record.role);
      return !(sessionMatches && roleMatches);
    });
    const removed = this.records.length - kept.length;
    this.records.splice(0, this.records.length, ...kept);
    writeFileSync(
      this.file,
      kept.length ? `${kept.map((record) => JSON.stringify(record)).join("\n")}\n` : "",
      "utf-8",
    );
    return { removed, remaining: kept.length };
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

  private score(record: MemoryRecord, query: string, queryProfile: TextProfile): number {
    const content = record.content.toLowerCase();
    const needle = query.trim().toLowerCase();
    const profile = textProfile(`${record.content} ${record.tags.join(" ")}`);
    let score = content.includes(needle) ? 1 : 0;

    const overlap = intersectionSize(queryProfile.expanded, profile.expanded);
    const union = new Set([...queryProfile.expanded, ...profile.expanded]).size || 1;
    const jaccard = overlap / union;
    const recall = overlap / queryProfile.expanded.size;
    score = Math.max(score, (jaccard * 0.7) + (recall * 0.6));

    const tagProfile = textProfile(record.tags.join(" "));
    const tagHits = intersectionSize(queryProfile.expanded, tagProfile.expanded);
    if (tagHits > 0) score += Math.min(0.25, tagHits * 0.1);

    if (record.role === "system") score += 0.03;
    return score;
  }
}

interface TextProfile {
  tokens: Set<string>;
  expanded: Set<string>;
}

function textProfile(text: string): TextProfile {
  const tokens = new Set(
    text
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.map(normalizeToken)
      .filter((token) => token.length >= 2) ?? [],
  );
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const synonym of SYNONYMS[token] ?? []) {
      expanded.add(normalizeToken(synonym));
    }
  }
  return { tokens, expanded };
}

function normalizeToken(token: string): string {
  return token
    .replace(/(?:ing|tion|ions|ed|es|s)$/i, "")
    .replace(/^authenticat$/i, "auth")
    .replace(/^automobile$/i, "auto");
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count++;
  }
  return count;
}
