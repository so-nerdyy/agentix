// EventBus — typed singleton event emitter for inter-module communication.
// Used by Powerhouse to coordinate PI agents, ApprovalWorkflow, SessionCoordinator,
// and the EventStreamBridge that fans events out to web clients.

import { EventEmitter } from "node:events";

export type AgentixEventMap = {
  // Agent lifecycle
  "agent:start": { agentId: string; agentKind: string; sessionId: string };
  "agent:complete": {
    agentId: string;
    agentKind: string;
    sessionId: string;
    result: unknown;
  };
  "agent:error": { agentId: string; error: string; sessionId: string };

  // Task lifecycle
  "task:queued": { taskId: string; sessionId: string; kind: string };
  "task:running": { taskId: string; sessionId: string };
  "task:approve": { taskId: string; sessionId: string };
  "task:reject": { taskId: string; sessionId: string; reason?: string };
  "task:complete": { taskId: string; sessionId: string; result: unknown };
  "task:failed": { taskId: string; sessionId: string; error: string };

  // Session lifecycle
  "session:create": { sessionId: string };
  "session:close": { sessionId: string };

  // Gateway lifecycle
  "gateway:message": {
    gatewayId: string;
    gatewayPlatform: string;
    sessionId: string;
    taskIds: string[];
  };
  "gateway:enabled": { gatewayId: string; gatewayPlatform: string; enabled: boolean };
  "gateway:disabled": { gatewayId: string; gatewayPlatform: string; enabled: boolean };

  // Powerhouse lifecycle
  "powerhouse:starting": Record<string, never>;
  "powerhouse:started": Record<string, never>;
  "powerhouse:stopping": Record<string, never>;
  "powerhouse:stopped": Record<string, never>;
};

export type AgentixEventName = keyof AgentixEventMap;

class TypedBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Healing/PI agents can fan out to many SSE clients; raise the limit
    // so we don't get MaxListenersExceededWarning in normal operation.
    this.emitter.setMaxListeners(0);
  }

  on<K extends AgentixEventName>(
    event: K,
    handler: (payload: AgentixEventMap[K]) => void,
  ): () => void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
    return () => this.off(event, handler);
  }

  once<K extends AgentixEventName>(
    event: K,
    handler: (payload: AgentixEventMap[K]) => void,
  ): void {
    this.emitter.once(event, handler as (...args: unknown[]) => void);
  }

  off<K extends AgentixEventName>(
    event: K,
    handler: (payload: AgentixEventMap[K]) => void,
  ): void {
    this.emitter.off(event, handler as (...args: unknown[]) => void);
  }

  emit<K extends AgentixEventName>(
    event: K,
    payload: AgentixEventMap[K],
  ): void {
    this.emitter.emit(event, payload);
  }

  listenerCount<K extends AgentixEventName>(event: K): number {
    return this.emitter.listenerCount(event);
  }

  removeAllListeners(event?: AgentixEventName): void {
    this.emitter.removeAllListeners(event);
  }
}

export const EventBus = new TypedBus();
