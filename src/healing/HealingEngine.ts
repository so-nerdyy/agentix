import { EventBus } from "../config/EventBus.js";

export interface FailureFingerprint {
  fingerprint: string;
  count: number;
  lastError: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

export class HealingEngine {
  private readonly failures = new Map<string, FailureFingerprint>();

  observeFailure(taskId: string, sessionId: string, error: string): FailureFingerprint {
    const fingerprint = this.fingerprint(error);
    const existing = this.failures.get(fingerprint);
    const now = Date.now();
    const record: FailureFingerprint = existing
      ? { ...existing, count: existing.count + 1, lastError: error, lastSeenAt: now }
      : { fingerprint, count: 1, lastError: error, firstSeenAt: now, lastSeenAt: now };

    this.failures.set(fingerprint, record);
    EventBus.emit("task:failed", { taskId, sessionId, error });
    return record;
  }

  adviceFor(error: string): string | null {
    const record = this.failures.get(this.fingerprint(error));
    if (!record || record.count < 2) return null;
    return `Repeated failure detected (${record.count}x): ${record.lastError}`;
  }

  list(): FailureFingerprint[] {
    return Array.from(this.failures.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  private fingerprint(error: string): string {
    return error
      .toLowerCase()
      .replace(/[0-9a-f]{8,}/g, "<id>")
      .replace(/\d+/g, "<n>")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  }
}
