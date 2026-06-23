# Architecture

Agentix is split into two layers:

## Hermes Layer

- Owns the user-facing shell
- Handles setup, model selection, update checks, cron, gateway, skills, tools, and other interactive commands
- Provides the terminal UX users launch with `agentix`
- Delegates backend-owned commands to Agentix when launched with `AGENTIX_FRONTEND=hermes`

## Agentix Backend

- Owns task orchestration and execution
- Manages sessions, approvals, and persistence
- Exposes the HTTP bridge and inbox/dashboard runtime
- Runs PI workers and validates results

## Hermes-to-Agentix Command Bridge

The installed `agentix` command launches Hermes for the frontend, but it sets `AGENTIX_FRONTEND=hermes` and points Hermes at the Agentix bridge. In that mode:

- `agentix`, `agentix chat`, and `agentix -z/--oneshot` execute prompts through Agentix Powerhouse/Symphony/Pi workers.
- `agentix --tui` keeps the Hermes TUI transport and streams prompt submissions through an Agentix bridge proxy.
- `agentix setup` and `agentix model` keep the Hermes provider/model UX, then sync non-secret model/provider/base URL defaults into Agentix backend config.
- `agentix cron` uses Agentix scheduler jobs.
- `agentix sessions list|stats|export|delete` uses Agentix sessions.
- `agentix memory status|search|consolidate` uses Agentix memory.
- `agentix tools list` lists Agentix Pi agents.
- `agentix logs` reads Agentix runtime logs.
- `agentix --agentix-cli plans`, shell `/plans`, and shell `/plan <id>` inspect Agentix Symphony plan executions.
- Dashboard `/ui` reads Agentix `/plans` and `/plans/:id` to inspect Symphony plan execution, dependencies, approvals, and task linkage.

Standalone upstream Hermes still uses its native local stores when those Agentix environment variables are absent.

## Core Backend Primitives

- `Powerhouse`-style orchestration is represented by the queue/session/approval/agent registry modules
- `SymphonyEngine` uses an LLM-backed planner when provider credentials are configured, with deterministic static fallback for offline or invalid planner output
- `PlanStore` persists Symphony plan execution state so approval-gated plans can resume after approval
- `TaskQueue` stores and prioritizes work
- `SessionCoordinator` persists session state
- `ApprovalWorkflow` gates approval-required work
- `PIAgentRegistry` binds task kinds to worker implementations, including dynamic command-backed Pi profiles stored under `data/agents/profiles.json`
- `ConversationAgent` calls the configured LLM provider when credentials are available and falls back to deterministic diagnostics when running offline
- `HealingEngine` fingerprints repeated failures, proposes procedures, auto-promotes stable repeated failures into advisory procedures, applies promoted procedures as retry guidance, and auto-deprecates procedures that keep failing

## Data Flow

1. The user types into the Hermes shell.
2. The shell emits a stimulus or command.
3. The Agentix backend receives the request through the bridge.
4. Symphony builds a safe plan, either from the LLM planner or static fallback.
5. The backend schedules each step, validates it, and routes it to a PI worker.
6. Approval-gated plans pause safely and resume remaining dependent steps after approval.
7. Failed retryable steps can receive promoted healing guidance before the next attempt; successful and failed procedure applications are fed back into the healing store.
8. Results stream back to the shell and are persisted under the workspace data directory.

## Workspace Layout

- Workspace-local Hermes config lives under `.agentix/hermes/`
- Persistent runtime state lives under `data/` by default
- The launcher passes `AGENTIX_WORKSPACE_DIR` to backend processes so tasks run from the caller's folder
- The launcher can override state paths with `AGENTIX_DATA_DIR`

