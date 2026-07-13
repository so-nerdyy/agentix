import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export class JsonFileStore<T> {
  private corruptBackupCreated = false;

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
      this.preserveCorruptState();
      return this.clone(this.fallback);
    }
  }

  write(value: T): void {
    const temporary = this.file + "." + process.pid + "." + randomUUID().slice(0, 8) + ".tmp";
    try {
      writeFileSync(temporary, JSON.stringify(value, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
      renameSync(temporary, this.file);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  update(fn: (current: T) => T): T {
    const next = fn(this.read());
    this.write(next);
    return next;
  }

  private clone(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private preserveCorruptState(): void {
    if (this.corruptBackupCreated || !existsSync(this.file)) return;
    const backup = `${this.file}.corrupt-${Date.now()}-${randomUUID().slice(0, 8)}`;
    try {
      copyFileSync(this.file, backup);
      chmodSync(backup, 0o600);
      this.corruptBackupCreated = true;
    } catch {
      // The original remains untouched when a read-only filesystem prevents backup.
    }
  }
}
