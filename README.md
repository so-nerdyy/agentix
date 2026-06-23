# Agentix

Agentix is a Hermes-class agent platform with an Agentix-owned backend.

- Hermes owns the user-facing shell, setup wizard, update flow, cron UX, gateway UX, and command surface.
- Agentix owns LLM-backed Symphony planning, task orchestration, validation, approvals, memory, healing, Pi agents, and runtime services.
- The web dashboard lives at `/ui` when `agentix server` is running, with live task, Symphony plan, approval, healing, memory, gateway, scheduler, audit, log, doctor, and support-bundle controls.

## Quick Start

```powershell
npm install -g agentix
agentix setup
agentix
```

Windows one-line install:

```powershell
irm https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.ps1 | iex
```

macOS/Linux one-line install:

```sh
curl -fsSL https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.sh | sh
```

From any project folder, `agentix` opens the interactive shell. Use `agentix dashboard` if you want the web control surface only, or `agentix server` if you want the backend bridge, event stream, and dashboard/API runtime. Open `http://127.0.0.1:3000/ui/` for the live control surface.

## Commands

- `agentix` - open the interactive Hermes-style shell
- `agentix chat` - open the Hermes chat shell backed by Agentix execution
- `agentix --tui` - open the Hermes TUI while routing prompts through Agentix
- `agentix -z "<prompt>"` - run a one-shot prompt through Agentix
- `agentix setup` - first-run setup wizard
- `agentix model` - configure provider and model
- `agentix update` - check update/install options
- `agentix doctor` - validate config and runtime health
- `agentix cron` - manage scheduled jobs
- `agentix gateway` - manage integrations
- `agentix skills` - manage skills/plugins
- `agentix tools list` - inspect Agentix Pi agents
- `agentix memory search <query>` - search Agentix memory
- `agentix sessions list` - inspect Agentix sessions
- `agentix --agentix-cli plans` - inspect Symphony plan executions
- `agentix --agentix-cli auth create admin <label>` - create workspace API token
- `agentix logs` - inspect Agentix runtime logs
- `agentix dashboard` - start the web control surface
- `agentix server` - start the Agentix backend bridge/API
- `agentix support` - generate a support bundle with runtime snapshots

## Configuration

Agentix uses workspace-scoped configuration and environment variables:

- `AGENTIX_DATA_DIR` - persistent data location
- `AGENTIX_WORKSPACE_DIR` - workspace root used for tasks and default `data/`
- `AGENTIX_BRIDGE_URL` - backend bridge URL
- `AGENTIX_BRIDGE_PORT` - bridge port
- `AGENTIX_INBOX_PORT` - inbox/dashboard port
- `AGENTIX_PROVIDER` - provider selected by `agentix setup` or `agentix model`
- `AGENTIX_MODEL` - default model
- `AGENTIX_BASE_URL` - optional OpenAI-compatible or provider-specific base URL
- `AGENTIX_LLM_API_KEY` - runtime API key
- `AGENTIX_SESSION_TOKEN` - optional admin Bearer token for dashboard/API/event access; workspace role tokens can also be created with the backend auth CLI
- `AGENTIX_SESSION_TTL` - session retention
- `AGENTIX_APPROVAL_TIMEOUT` - approval timeout
- `AGENTIX_HERMES_VENV` - optional Python venv location for the bundled Hermes frontend
- `AGENTIX_PYTHON` - optional Python 3 executable override for the bundled Hermes frontend

By default, Agentix stores Hermes frontend state under `.agentix/hermes/` in the current workspace and backend runtime state under `data/`. `agentix setup` and `agentix model` use the Hermes provider/model picker, then sync non-secret defaults into `data/config.json`. Provider API keys stay in Hermes' `.env` or your process environment and are injected into the backend at launch.

## Project Layout

- `bin/` - installed entrypoint
- `src/` - Agentix backend, shell fallback, and bridge
- `frontend/src/` - editable interactive dashboard source
- `frontend/dist/` - generated dashboard served by the inbox server
- `hermes-agent/` - Hermes frontend runtime used by the launcher
- `docs/` - install, operations, and security notes

## Development

```powershell
npm install
npm run build
npm test
```

## Documentation

- [Install](docs/INSTALL.md)
- [API](docs/API.md)
- [Operations](docs/OPERATIONS.md)
- [Security](docs/SECURITY.md)
- [Architecture](docs/ARCHITECTURE.md)
