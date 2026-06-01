// PIAgentRegistry — tracks available PI agents and routes tasks to them.
// Phase 2 keeps the agent classes in-process (BasePIAgent, SandboxAgent, etc.).
// The registry is what Powerhouse asks for an executor given a task.kind.

import type { Task } from "./types.js";
import type { BasePIAgent } from "../pi/BasePIAgent.js";

export class PIAgentRegistry {
  private readonly byKind = new Map<string, BasePIAgent>();
  private readonly byId = new Map<string, BasePIAgent>();
  private monitorTimer: NodeJS.Timeout | null = null;

  register(agent: BasePIAgent): void {
    this.byKind.set(agent.kind, agent);
    this.byId.set(agent.id, agent);
  }

  forKind(kind: string): BasePIAgent | undefined {
    return this.byKind.get(kind);
  }

  get(id: string): BasePIAgent | undefined {
    return this.byId.get(id);
  }

  list(): BasePIAgent[] {
    return Array.from(this.byId.values());
  }

  pickFor(task: Task): BasePIAgent | undefined {
    return this.forKind(task.kind);
  }

  /**
   * Health monitor: in Phase 2 the agents are in-process so they don't really
   * "crash," but we still expose a liveness probe that the test suite and
   * Phase 3 healing engine can hook into.
   */
  startHealthMonitor(intervalMs = 5000): void {
    this.stopHealthMonitor();
    const t = setInterval(() => {
      for (const a of this.list()) {
        if (!a.healthy()) {
          // In Phase 3, the SelfHealingEngine will handle this. For now,
          // just log.
          console.error(`[PIAgentRegistry] agent ${a.id} (${a.kind}) unhealthy`);
        }
      }
    }, intervalMs);
    t.unref?.();
    this.monitorTimer = t;
  }

  stopHealthMonitor(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  shutdown(): void {
    this.stopHealthMonitor();
    for (const a of this.list()) a.shutdown?.();
    this.byKind.clear();
    this.byId.clear();
  }
}
