# Architecture

Agentix is split into two layers:

## Hermes Layer

- Owns the user-facing shell
- Handles setup, model selection, update checks, cron, gateway, skills, tools, and other interactive commands
- Provides the terminal UX users launch with `agentix`

## Agentix Backend

- Owns task orchestration and execution
- Manages sessions, approvals, and persistence
- Exposes the HTTP bridge and inbox/dashboard runtime
- Runs PI workers and validates results

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

