# Operations

## Runtime Components

- Hermes frontend: user-facing shell, setup, update, cron, gateway, model, and command UX
- Agentix backend: bridge/API, task orchestration, memory, approvals, validation, and Pi workers
- Data directory: persistent workspace state under `AGENTIX_DATA_DIR` or `./data`

## Ports

- `3000` - inbox/dashboard server
- `3456` - Agentix bridge server

## Logs and State

- Logs are stored under the data directory
- Sessions are stored under the data directory
- Memory and sandbox artifacts are stored under the data directory

## Health Checks

- `GET /health` on the inbox server
- `GET /health` on the bridge server
- `agentix doctor` for configuration and runtime validation

## Support Bundle

Use `agentix support` to create a timestamped bundle under `data/support/` with:

- manifest metadata
- sanitized config
- sessions, tasks, approvals, jobs, audit, healing, and memory snapshots

## Recovery

- Stop the running shell before upgrading the launcher
- Keep workspace config files in place during upgrades
- If the bridge is down, restart it with `agentix server`

