import { EventBus } from "../config/EventBus.js";
import { join } from "node:path";
import { PATHS } from "../config/paths.js";
import { JsonFileStore } from "../storage/JsonFileStore.js";

export interface FailureFingerprint {
  fingerprint: string;
  count: number;
  lastError: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface HealingProcedure {
  id: string;
  fingerprint: string;
  status: "candidate" | "promoted" | "deprecated";
  summary: string;
  createdAt: number;
  updatedAt: number;
  uses: number;
}

export interface HealingDetail {
  failure: FailureFingerprint | null;
  procedure: HealingProcedure | null;
}

interface HealingStoreFile {
  failures: FailureFingerprint[];
  procedures: HealingProcedure[];
}

export class HealingEngine {
  private readonly store: JsonFileStore<HealingStoreFile>;

  constructor(file = join(PATHS.dataDir, "healing", "healing.json")) {
    this.store = new JsonFileStore(file, { failures: [], procedures: [] });
  }

  observeFailure(taskId: string, sessionId: string, error: string): FailureFingerprint {
    const fingerprint = this.fingerprint(error);
    const current = this.store.read();
    const existing = current.failures.find((item) => item.fingerprint === fingerprint);
    const now = Date.now();
    const record: FailureFingerprint = existing
      ? { ...existing, count: existing.count + 1, lastError: error, lastSeenAt: now }
      : { fingerprint, count: 1, lastError: error, firstSeenAt: now, lastSeenAt: now };

    const failures = [
      ...current.failures.filter((item) => item.fingerprint !== fingerprint),
      record,
    ];
    let procedures = current.procedures;
    if (record.count >= 2 && !procedures.some((item) => item.fingerprint === fingerprint)) {
      procedures = [
        ...procedures,
        {
          id: `proc-${Math.random().toString(36).slice(2, 10)}`,
          fingerprint,
          status: "candidate",
          summary: `Investigate and handle repeated failure: ${record.lastError}`,
          createdAt: now,
          updatedAt: now,
          uses: 0,
        },
      ];
    }
    this.store.write({ failures, procedures });
    EventBus.emit("task:failed", { taskId, sessionId, error });
    return record;
  }

  adviceFor(error: string): string | null {
    const fingerprint = this.fingerprint(error);
    const state = this.store.read();
    const promoted = state.procedures.find(
      (item) => item.fingerprint === fingerprint && item.status === "promoted",
    );
    if (promoted) return promoted.summary;
    const record = state.failures.find((item) => item.fingerprint === fingerprint);
    if (!record || record.count < 2) return null;
    return `Repeated failure detected (${record.count}x): ${record.lastError}`;
  }

  list(): FailureFingerprint[] {
    return this.store
      .read()
      .failures.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  listProcedures(): HealingProcedure[] {
    return this.store.read().procedures.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getFailure(fingerprint: string): FailureFingerprint | undefined {
    return this.store.read().failures.find((item) => item.fingerprint === fingerprint);
  }

  getProcedure(id: string): HealingProcedure | undefined {
    return this.store.read().procedures.find((item) => item.id === id);
  }

  promoteProcedure(id: string): HealingProcedure | undefined {
    return this.updateProcedure(id, { status: "promoted" });
  }

  deprecateProcedure(id: string): HealingProcedure | undefined {
    return this.updateProcedure(id, { status: "deprecated" });
  }

  useProcedureFor(error: string): HealingProcedure | undefined {
    const fingerprint = this.fingerprint(error);
    const procedure = this.store
      .read()
      .procedures.find((item) => item.fingerprint === fingerprint && item.status === "promoted");
    if (!procedure) return undefined;
    return this.updateProcedure(procedure.id, { uses: procedure.uses + 1 });
  }

  private updateProcedure(
    id: string,
    patch: Partial<HealingProcedure>,
  ): HealingProcedure | undefined {
    let updated: HealingProcedure | undefined;
    this.store.update((current) => ({
      ...current,
      procedures: current.procedures.map((procedure) => {
        if (procedure.id !== id) return procedure;
        updated = { ...procedure, ...patch, updatedAt: Date.now() };
        return updated;
      }),
    }));
    return updated;
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
