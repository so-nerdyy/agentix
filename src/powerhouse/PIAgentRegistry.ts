// PIAgentRegistry — tracks available PI agents and routes tasks to them.
// Powerhouse asks the registry for an executor given a task.kind.

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
    const agent = this.byKind.get(kind);
    return agent?.healthy() ? agent : undefined;
  }

  get(id: string): BasePIAgent | undefined {
    return this.byId.get(id);
  }

  unregister(id: string): BasePIAgent | undefined {
    const agent = this.byId.get(id);
    if (!agent) return undefined;
    this.byId.delete(id);
    agent.shutdown?.();
    if (this.byKind.get(agent.kind)?.id === id) {
      this.byKind.delete(agent.kind);
      const replacement = Array.from(this.byId.values()).find(
        (candidate) => candidate.kind === agent.kind && candidate.healthy(),
      );
      if (replacement) this.byKind.set(agent.kind, replacement);
    }
    return agent;
  }

  list(): BasePIAgent[] {
    return Array.from(this.byId.values());
  }

  pickFor(task: Task): BasePIAgent | undefined {
    return this.forKind(task.kind);
  }

  /**
   * Health monitor for in-process agents. The healing engine consumes these
   * signals when the backend detects repeated failures.
   */
  startHealthMonitor(intervalMs = 5000): void {
    this.stopHealthMonitor();
    const t = setInterval(() => {
      for (const a of this.list()) {
        if (!a.healthy()) {
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
