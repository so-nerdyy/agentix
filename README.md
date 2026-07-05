# Agentix

Agentix is an AI agent platform with an Agentix-owned shell, setup flow, dashboard, and backend.

- Agentix owns the user-facing shell, setup wizard, update flow, cron UX, gateway UX, and command surface.
- Agentix owns LLM-backed Symphony planning, task orchestration, validation, approvals, memory, healing, Pi agents, and runtime services.
- The web dashboard lives at `/ui` when `agentix server` is running, with live task, Symphony plan, approval, healing, memory, gateway, scheduler, audit, log, doctor, and support-bundle controls.

## Quick Start

```powershell
npm install -g @nerdyy/agentix
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

Verified GitHub release install:

```sh
AGENTIX_VERSION=2.1.6 curl -fsSL https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.sh | sh
```

From any project folder, `agentix` opens the interactive shell. Use `agentix dashboard` if you want the web control surface only, or `agentix server` if you want the backend bridge, event stream, and dashboard/API runtime. Open `http://127.0.0.1:3000/ui/` for the live control surface.

## Commands

- `agentix` - open the interactive Agentix shell
- `agentix -z "<prompt>"` - run a one-shot prompt through Agentix
- `agentix setup` - first-run setup wizard
- `agentix model` - configure provider and model
- `agentix options` - list setup/provider/model/environment options
- `agentix update` - check update/install options
- `agentix doctor` - validate config and runtime health
- `agentix readiness` - report private-beta and public-release gates
- `agentix cron` - manage scheduled jobs
- `agentix gateway` - manage integrations
- `agentix skills` - manage skills/plugins
- `agentix agents` - manage dynamic command-backed Pi agent profiles
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
- `KILOCODE_API_KEY` - accepted alias for Kilo Gateway when `AGENTIX_PROVIDER=kilocode`
- `AGENTIX_SESSION_TOKEN` - optional admin Bearer token for dashboard/API/event access; workspace role tokens can also be created with the backend auth CLI
- `AGENTIX_SESSION_TTL` - session retention
- `AGENTIX_APPROVAL_TIMEOUT` - approval timeout
- `AGENTIX_PYTHON_VENV` - optional Python venv location for bundled compatibility internals
- `AGENTIX_PYTHON` - optional Python 3 executable override for bundled compatibility internals
- `AGENTIX_SANDBOX_MODE` - `auto`, `docker`, or `local` sandbox execution mode
- `AGENTIX_SANDBOX_DOCKER_IMAGE` - Docker image for containerized sandbox execution

By default, Agentix stores workspace runtime state under `data/`. `agentix setup` and `agentix model` write API secrets to `.env.local` and sync non-secret provider/model/base URL defaults into `data/config.json`.

Kilo Gateway first-class setup:

```powershell
agentix config set provider kilocode
agentix config set model <kilo-model-id>
agentix config set baseUrl https://api.kilo.ai/api/gateway
$env:KILOCODE_API_KEY="<kilo-gateway-key>"
```

## Project Layout

- `bin/` - installed entrypoint
- `src/` - Agentix backend, shell fallback, and bridge
- `frontend/src/` - editable interactive dashboard source
- `frontend/dist/` - generated dashboard served by the inbox server
- `hermes-agent/` - vendored compatibility runtime used internally
- `docs/` - install, operations, and security notes

## Development

```powershell
npm install
npm run build
npm test
npm run smoke:release
```

Docker runtime:

```powershell
docker build -t agentix:local .
$env:AGENTIX_SESSION_TOKEN = "replace-with-a-long-random-token"
docker compose up
```

Public-release readiness:

```powershell
npm run release:preflight -- --require-llm
npm run release:manifest
npm run verify:llm -- --out data/release/live-llm-proof.json
npm run release:verify -- --out data/release/public-release-proof.json
agentix readiness
```

`agentix readiness` stays at `private-beta-ready` until both proof files exist: one from a live model call, one from published npm/GitHub release verification. Public release also requires a public GitHub repository and an `NPM_TOKEN` with publish rights for `@nerdyy/agentix`.

## Documentation

- [Install](docs/INSTALL.md)
- [API](docs/API.md)
- [Operations](docs/OPERATIONS.md)
- [Security](docs/SECURITY.md)
- [Architecture](docs/ARCHITECTURE.md)
