import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PATHS } from "../config/paths.js";

export interface AuditEntry {
  id: string;
  type: string;
  actor: "system" | "user" | "scheduler" | "gateway";
  createdAt: number;
  subjectId?: string;
  data: Record<string, unknown>;
}

export class AuditLog {
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
}
