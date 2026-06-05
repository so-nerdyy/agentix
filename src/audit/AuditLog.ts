import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PATHS } from "../config/paths.js";
import { RuntimeLogStore } from "../logging/RuntimeLogStore.js";

export interface AuditEntry {
  id: string;
  type: string;
  actor: "system" | "user" | "scheduler" | "gateway";
  createdAt: number;
  subjectId?: string;
  data: Record<string, unknown>;
}

export class AuditLog {
  private readonly runtimeLogs = new RuntimeLogStore();

  constructor(private readonly file = join(PATHS.dataDir, "audit", "audit.jsonl")) {
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(this.file)) writeFileSync(this.file, "", "utf-8");
  }

  record(entry: Omit<AuditEntry, "id" | "createdAt">): AuditEntry {
    const next: AuditEntry = {
      ...entry,
      id: `audit-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: Date.now(),
    };
    appendFileSync(this.file, `${JSON.stringify(next)}\n`, "utf-8");
    this.runtimeLogs.record({
      timestamp: new Date(next.createdAt).toISOString(),
      level: this.levelFor(entry.type),
      source: entry.actor,
      message: `${entry.type}${entry.subjectId ? ` ${entry.subjectId}` : ""}${
        Object.keys(entry.data || {}).length > 0 ? ` ${JSON.stringify(entry.data)}` : ""
      }`.trim(),
    });
    return next;
  }

  list(limit = 100): AuditEntry[] {
    if (!existsSync(this.file)) return [];
    const rows = readFileSync(this.file, "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is AuditEntry => Boolean(entry));
    return rows.slice(-limit).reverse();
  }

  private levelFor(type: string): "info" | "warn" | "error" {
    if (type.includes("failed") || type.includes("error") || type.includes("rejected")) {
      return "error";
    }
    if (type.includes("warning") || type.includes("disabled") || type.includes("deprecated")) {
      return "warn";
    }
    return "info";
  }
}
