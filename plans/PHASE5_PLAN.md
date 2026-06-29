# Phase 5 - Productization and Final UX

## Purpose

Turn the rebuilt core into a product people can actually run end to end: shell, setup, update, cron, gateway, dashboard, support, and install flows must feel complete.

## Scope

- Hermes owns the visible product shell.
- Agentix owns the execution backend and canonical state.
- The default `agentix` command should open the interactive shell from any project folder.
- `agentix setup`, `agentix model`, `agentix update`, `agentix doctor`, `agentix cron`, and `agentix gateway` must be first-class commands.

## Implementation

- Workspace-scoped config and data directories.
- Global install support and local project bootstrap.
- Hermes-style terminal UX, themes, slash commands, and session restore.
- Update checks and installer guidance.
- Support bundle generation and diagnostics.
- Dashboard and bridge startup paths.

## Acceptance Criteria

- A new user can install, configure, and run the product without reading source code.
- The shell opens in the current folder and uses that folder as the workspace context.
- Backend commands remain Agentix-owned and shell commands remain UX-owned.
- Install, update, and doctor flows are reproducible on a clean machine.

