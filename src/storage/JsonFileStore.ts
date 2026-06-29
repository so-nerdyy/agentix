import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class JsonFileStore<T> {
  constructor(
    private readonly file: string,
    private readonly fallback: T,
  ) {
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  read(): T {
    if (!existsSync(this.file)) {
      this.write(this.fallback);
      return this.clone(this.fallback);
    }

    try {
      return JSON.parse(readFileSync(this.file, "utf-8")) as T;
    } catch {
      return this.clone(this.fallback);
    }
  }

  write(value: T): void {
    writeFileSync(this.file, JSON.stringify(value, null, 2), "utf-8");
  }

  update(fn: (current: T) => T): T {
    const next = fn(this.read());
    this.write(next);
    return next;
  }

  private clone(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
