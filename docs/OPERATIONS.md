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
- By default, `agentix` treats the current working directory as the workspace and stores state in `./data`
- Set `AGENTIX_DATA_DIR` to move persistent state, or `AGENTIX_HERMES_VENV` to move the bundled Hermes Python environment

## Hermes Command Delegation

When `agentix` launches Hermes, it sets `AGENTIX_FRONTEND=hermes`. In this mode Hermes command UX delegates backend-owned state to Agentix:

- `agentix`, `agentix chat`, and `agentix -z/--oneshot` execute prompts through the Agentix bridge
- `agentix --tui` uses the Hermes TUI transport but submits prompts through an Agentix backend proxy
- `agentix sessions list|stats|export|delete`
- `agentix memory status|search|consolidate`
- `agentix tools list`
- `agentix logs`
- `agentix cron`

Set `AGENTIX_DISABLE_BACKEND_COMMANDS=1` only for debugging upstream Hermes command behavior. Set `AGENTIX_DISABLE_BACKEND_CHAT=1` only for debugging upstream Hermes prompt execution.

## Health Checks

- `GET /health` on the inbox server
- `GET /health` on the bridge server
- `agentix doctor` for configuration and runtime validation

## Release Smoke

Before publishing a release, run:

```powershell
npm run build
npm test
npm run smoke:release
```

The release smoke packs the npm artifact, installs it into an isolated temporary prefix, runs `agentix version`, `agentix help`, and `agentix support`, starts the installed server, verifies both health endpoints, loads `/ui/`, executes a task, runs a scheduler job, and creates a support bundle.

## Support Bundle

Use `agentix support` to create a timestamped bundle under `data/support/` with:

- manifest metadata
- sanitized config
- sessions, tasks, approvals, jobs, audit, healing, and memory snapshots

## Recovery

- Stop the running shell before upgrading the launcher
- Keep workspace config files in place during upgrades
- If the bridge is down, restart it with `agentix server`

