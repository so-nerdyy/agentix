# Phase 6 - Powerhouse Runtime Boundary

## Purpose

Define the formal outer control plane for Agentix so the orchestration layer is explicit and testable.

## Scope

- `Powerhouse` owns task/session lifecycle coordination.
- `Symphony` remains the planner/orchestrator.
- Pi agents remain the execution units.
- Shared contracts govern tasks, sessions, approvals, and memory.

## Implementation

- Startup and shutdown lifecycle.
- Event bus wiring and cleanup.
- Session recovery on process restart.
- Clear ownership boundaries between shell, control plane, and worker execution.

## Acceptance Criteria

- Powerhouse starts and stops cleanly.
- It never becomes a second planner or second task store.
- Lifecycle events are emitted and consumed consistently across the runtime.

