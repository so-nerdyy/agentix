# Agentix Build Spec

Agentix is a Hermes-class agent platform with a Hermes-owned user surface and an Agentix-owned backend.

## System Boundary

- Hermes owns terminal UX, setup, update, cron, gateway, model selection, and other user-facing flows.
- Agentix owns execution, orchestration, validation, approvals, memory, persistence, and Pi workers.

## Core Backend Roles

- `Powerhouse` coordinates outer lifecycle and task/session state.
- `Symphony` plans and sequences work.
- Pi agents execute bounded subtasks.
- The bridge exposes runtime state to the shell and dashboard.

## Product Surfaces

- Terminal shell
- Dashboard
- Channels and gateways
- Support and diagnostics
- Setup and update flows

## Acceptance Rule

No surface may become a second source of truth for tasks, approvals, memory, or execution state.

