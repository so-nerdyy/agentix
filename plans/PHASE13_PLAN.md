# Phase 13 - Terminal and REPL Bridge

## Purpose

Bridge the Hermes-style user shell to the Agentix backend cleanly.

## Scope

- Terminal interaction loop.
- Streaming responses.
- Session restore.
- Command routing.

## Implementation

- Shell adapter boundary.
- Backend stimulus bridge.
- Interactive and non-interactive modes.

## Acceptance Criteria

- The shell can start from any workspace.
- The shell delegates execution to the backend instead of owning it.

