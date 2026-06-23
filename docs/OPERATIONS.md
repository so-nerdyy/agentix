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
- By default, Hermes frontend config for that workspace is stored in `.agentix/hermes/`
- Set `AGENTIX_DATA_DIR` to move persistent state, `AGENTIX_HERMES_VENV` to move the bundled Hermes Python environment, or `AGENTIX_PYTHON` to force a specific Python 3 executable

## Hermes Command Delegation

When `agentix` launches Hermes, it sets `AGENTIX_FRONTEND=hermes`. In this mode Hermes command UX delegates backend-owned state to Agentix:

- `agentix`, `agentix chat`, and `agentix -z/--oneshot` execute prompts through the Agentix bridge
- `agentix --tui` uses the Hermes TUI transport but submits prompts through an Agentix backend proxy
- `agentix setup` and `agentix model` use Hermes provider/model UX, then sync non-secret backend defaults into Agentix
- `agentix sessions list|stats|export|delete`
- `agentix memory status|search|consolidate`
- `agentix tools list`
- `agentix logs`
- `agentix cron`
- `agentix --agentix-cli plans` and shell `/plans` inspect Agentix Symphony plans

Set `AGENTIX_DISABLE_BACKEND_COMMANDS=1` only for debugging upstream Hermes command behavior. Set `AGENTIX_DISABLE_BACKEND_CHAT=1` only for debugging upstream Hermes prompt execution.

## Planning

Symphony attempts LLM-backed planning when `AGENTIX_LLM_API_KEY` and provider/model settings are available. Planner output is accepted only if it sanitizes into known Pi-agent step kinds. Shell, code-edit, and sandbox steps are approval-gated regardless of what the planner returns. If the LLM planner is unavailable or returns invalid JSON, Agentix falls back to deterministic static planning and records the fallback reason in audit metadata.

Approval-gated plans are persisted in `PlanStore`. When an approval is granted, Powerhouse resumes the saved Symphony plan from completed step IDs and runs any newly unblocked dependent steps. If another approval-gated step is reached, the plan pauses again instead of bypassing approval.

## Healing

Repeated task failures create candidate healing procedures. Promoted procedures are applied during retryable Symphony steps by injecting procedure guidance into the next Pi-agent attempt and recording `healing.procedure_applied` in the audit log. This does not bypass approval gates; shell, code-edit, and sandbox steps still require approval before execution.

## Health Checks

- `GET /health` on the inbox server
- `GET /health` on the bridge server
- `agentix doctor` for Hermes diagnostics; `agentix --agentix-cli doctor` or `GET /doctor` for Agentix backend diagnostics
- If `AGENTIX_SESSION_TOKEN` is configured, it acts as an admin bearer token for all non-health control endpoints
- Workspace API tokens can be created with `agentix --agentix-cli auth create [viewer|operator|admin] [label]`; plaintext is printed once and hashes persist under `data/auth/tokens.json`
- Role policy: `viewer` can read, `operator` can mutate runtime resources, `admin` can manage config/auth and memory reset
- If neither env token nor workspace token exists, loopback servers run in local dev-open mode; non-loopback binds require a token or explicit `AGENTIX_ALLOW_UNAUTHENTICATED=1`

## Release Smoke

Before publishing a release, run:

```powershell
npm run build
npm test
npm run smoke:release
```

The release smoke packs the npm artifact, installs it into an isolated temporary prefix, runs `agentix version`, `agentix help`, and `agentix support`, starts the installed server, verifies both health endpoints, loads `/ui/`, executes a task through the Hermes frontend adapter, runs a scheduler job, and creates a support bundle.

## Support Bundle

Use `agentix support` to create a timestamped bundle under `data/support/` with:

- manifest metadata
- sanitized config
- sessions, tasks, approvals, jobs, audit, healing, doctor, and memory snapshots
- plan execution snapshots

## Recovery

- Stop the running shell before upgrading the launcher
- Keep workspace config files in place during upgrades
- If the bridge is down, restart it with `agentix server`

