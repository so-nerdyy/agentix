# Phase 7 - Mod and Skill Ecosystem

## Purpose

Make the product extensible without changing the core orchestration path.

## Scope

- Skills, tools, mods, and plugins must be discoverable and loadable.
- Hermes-style shell commands should expose the extensibility surface.
- Agentix backend must remain the source of truth for execution and permissions.

## Implementation

- Mod discovery and registration.
- Skill manifest loading.
- Command surface for install/list/enable/disable/inspect.
- Validation for untrusted extensions.

## Acceptance Criteria

- New mods can be added without editing orchestration internals.
- Users can inspect and manage enabled capabilities from the shell.

