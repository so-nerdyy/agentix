import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PATHS } from "../config/paths.js";

export interface RuntimeLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  source: "system" | "user" | "scheduler" | "gateway";
  message: string;
}

export class RuntimeLogStore {
  constructor(private readonly file = join(PATHS.logsDir, "runtime.jsonl")) {
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(this.file)) writeFileSync(this.file, "", "utf-8");
  }

  record(entry: RuntimeLogEntry): RuntimeLogEntry {
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, "utf-8");
    return entry;
  }

  list(limit = 100): RuntimeLogEntry[] {
    if (!existsSync(this.file)) return [];
    const rows = readFileSync(this.file, "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as RuntimeLogEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is RuntimeLogEntry => Boolean(entry));
    return rows.slice(-limit).reverse();
  }
}
