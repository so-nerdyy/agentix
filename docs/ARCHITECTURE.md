# Architecture

Agentix is split into two layers:

## Hermes-Derived Frontend Layer

- Renders the full-screen terminal interface users launch with `agentix`
- Handles setup, model selection, update checks, cron, gateway, skills, tools, and other interactive commands
- Does not own model execution, planning, tasks, approvals, memory, healing, or
  durable Agentix sessions
- Delegates prompt execution to the Agentix bridge through `_AgentixTuiProxy`

The piped/non-TTY fallback shell is implemented directly in TypeScript for stable
automation. `docs/HERMES_PARITY.md` tracks frontend paths that still require
migration away from Hermes state or command dispatch.

## Agentix Backend

- Owns task orchestration and execution
- Manages sessions, approvals, and persistence
- Exposes the HTTP bridge and inbox/dashboard runtime
- Runs PI workers and validates results

## Agentix Command Bridge

The installed `agentix` command starts the Agentix bridge and launches the bundled
terminal frontend. In that mode:

- `agentix` and `agentix -z/--oneshot` execute prompts through Agentix Powerhouse/Symphony/Pi workers.
- `agentix setup` and `agentix model` use the Agentix setup wizard, writing secrets to `.env.local` and syncing non-secret model/provider/base URL defaults into Agentix backend config.
- `agentix options` lists provider/model/environment options.
- `agentix cron` uses Agentix scheduler jobs.
- `agentix sessions list|delete` uses Agentix sessions.
- `agentix memory status|search|consolidate` uses Agentix memory.
- `agentix tools list` lists Agentix Pi agents.
- `agentix logs` reads Agentix runtime logs.
- `agentix --agentix-cli plans`, shell `/plans`, and shell `/plan <id>` inspect Agentix Symphony plan executions.
- Dashboard `/ui` reads Agentix `/plans` and `/plans/:id` to inspect Symphony plan execution, dependencies, approvals, and task linkage.

Hermes-derived frontend code is part of the public UX, but its agent loop and
durable state stores are not part of the Agentix backend.

## Core Backend Primitives

- `Powerhouse`-style orchestration is represented by the queue/session/approval/agent registry modules
- `SymphonyEngine` uses an LLM-backed planner when provider credentials are configured, with deterministic static planning when the planner is unavailable or invalid. Independent steps execute in bounded parallel waves, and completed dependency outputs are supplied to downstream synthesis steps.
- `PlanStore` persists running, approval-paused, failed, completed, and cancelled Symphony plan execution state. Interrupted plans resume from completed steps, and `retry-failed` reruns failed work before continuing newly unblocked dependents.
- `TaskQueue` stores and prioritizes work
- `SessionCoordinator` persists session state
- `ApprovalWorkflow` gates approval-required work
- `PIAgentRegistry` binds task kinds to worker implementations, including configured `luna-message` and `terra-message` model-backed workers plus dynamic command-backed Pi profiles stored under `data/agents/profiles.json`.
- `ConversationAgent` calls the configured LLM provider, forwards native OpenAI-compatible or Anthropic SSE deltas for single conversational steps, and returns an actionable failed task for missing credentials, authentication errors, timeouts, malformed responses, or cancellation; it never reports provider failure as successful conversation output.
- `MemoryStore` persists JSONL records and ranks retrieval with local token normalization, synonym expansion, tag boosts, and recency tie-breaks
- `HealingEngine` fingerprints repeated failures, proposes procedures, auto-promotes stable repeated failures into advisory procedures, applies promoted procedures as retry guidance, and auto-deprecates procedures that keep failing

## Data Flow

1. The user types into the Agentix terminal UI or automation shell.
2. The frontend emits a stimulus or Agentix command.
3. The Agentix backend receives the request through the bridge.
4. Symphony builds a safe plan, either from the LLM planner or static fallback.
5. The backend schedules independent steps in bounded parallel waves, validates each result, and routes focused or complex conversational work to configured Luna or Terra Pi workers.
6. Downstream steps receive completed dependency results. Approval-gated and interrupted plans persist safely and resume remaining dependent steps.
7. Failed retryable steps can receive promoted healing guidance before the next attempt; successful and failed procedure applications are fed back into the healing store.
8. Native model deltas and lifecycle events stream back through the bridge; the
   aggregated final response is persisted under the workspace data directory.

## Workspace Layout

- Workspace-local Agentix config lives under `.env.local` and `data/config.json`
- Persistent runtime state lives under `data/` by default
- The launcher passes `AGENTIX_WORKSPACE_DIR` to backend processes so tasks run from the caller's folder
- The launcher can override state paths with `AGENTIX_DATA_DIR`

