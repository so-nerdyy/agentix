# Phase 18 - Channel Integrations

## Purpose

Let external channels create and observe tasks without bypassing the backend.

## Scope

- Slack, Teams, Discord, Telegram, webhook, and other supported transports.
- Message ingestion and reply routing.
- Channel-specific formatting.

## Implementation

- Channel adapters.
- Idempotent delivery.
- Task/session correlation across channels.

## Acceptance Criteria

- A task created from a channel is the same task seen in the shell and dashboard.
- Replies route back to the originating channel.

