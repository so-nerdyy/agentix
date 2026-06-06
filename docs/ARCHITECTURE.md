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
- `agentix cron` uses Agentix scheduler jobs.
- `agentix sessions list|stats|export|delete` uses Agentix sessions.
- `agentix memory status|search|consolidate` uses Agentix memory.
- `agentix tools list` lists Agentix Pi agents.
- `agentix logs` reads Agentix runtime logs.

Standalone upstream Hermes still uses its native local stores when those Agentix environment variables are absent.

## Core Backend Primitives

- `Powerhouse`-style orchestration is represented by the queue/session/approval/agent registry modules
- `TaskQueue` stores and prioritizes work
- `SessionCoordinator` persists session state
- `ApprovalWorkflow` gates approval-required work
- `PIAgentRegistry` binds task kinds to worker implementations

## Data Flow

1. The user types into the Hermes shell.
2. The shell emits a stimulus or command.
3. The Agentix backend receives the request through the bridge.
4. The backend schedules a task, validates it, and routes it to a PI worker.
5. Results stream back to the shell and are persisted under the workspace data directory.

## Workspace Layout

- Workspace-local config lives under the current project directory
- Persistent runtime state lives under `data/` by default
- The launcher can override paths with `AGENTIX_DATA_DIR`

