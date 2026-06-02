import { LocalAgentixRuntime } from "./LocalAgentixRuntime.js";

let runtime: LocalAgentixRuntime | null = null;

export function getBackendRuntime(): LocalAgentixRuntime {
  runtime ??= new LocalAgentixRuntime();
  return runtime;
}

export function shutdownBackendRuntime(): void {
  runtime?.shutdown();
  runtime = null;
}
