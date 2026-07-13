# Operations

## Runtime Components

- Agentix terminal frontend: Hermes-derived TUI plus setup, update, cron, gateway,
  model, options, and command UX
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
- By default, Agentix setup writes secrets to `.env.local` and non-secret defaults to `data/config.json`
- Set `AGENTIX_DATA_DIR` to move persistent state, `AGENTIX_PYTHON_VENV` to move bundled compatibility internals, or `AGENTIX_PYTHON` to force a specific Python 3 executable

## Agentix Command Surface

When `agentix` launches interactively, it starts the full-screen terminal UI and
connects it to the Agentix bridge:

- `agentix` opens the full-screen terminal UI
- `agentix --tui` explicitly selects the same terminal UI
- `agentix -z/--oneshot` executes prompts through the Agentix bridge
- `agentix setup` and `agentix model` configure provider/model/base URL/API key for Agentix
- Kilo Gateway uses provider `kilocode`, base URL `https://api.kilo.ai/api/gateway`, and `AGENTIX_LLM_API_KEY`, `KILOCODE_API_KEY`, or `KILO_API_KEY`
- `agentix options` lists provider/model/environment options
- `agentix sessions list|stats|export|delete`
- `agentix memory status|search|consolidate`
- `agentix tools list`
- `agentix logs`
- `agentix cron`
- `agentix --agentix-cli plans` and shell `/plans` inspect Agentix Symphony plans

Bundled compatibility internals are implementation detail, not the public command surface.

## Planning

Symphony attempts LLM-backed planning when `AGENTIX_LLM_API_KEY` and provider/model settings are available. Planner output is accepted only if it sanitizes into known Pi-agent step kinds. Shell, code-edit, and sandbox steps are approval-gated regardless of what the planner returns. If the LLM planner is unavailable or returns invalid JSON, Agentix falls back to deterministic static planning and records the fallback reason in audit metadata.

Set `AGENTIX_LUNA_MODEL` for bounded reviews, tests, documentation, and focused fixes. Set `AGENTIX_TERRA_MODEL` for architecture, concurrency, security, migrations, and other complex work. Both are ordinary Pi agents controlled by Powerhouse and scheduled by Symphony; they do not own a second agent loop. `luna:` and `terra:` prefixes request an explicit delegate. `AGENTIX_SYMPHONY_CONCURRENCY` controls the parallel-wave limit and defaults to 4.

Provider calls use a 60-second per-attempt timeout and up to three bounded attempts by default. The timeout remains active while response bodies and native SSE streams are consumed. Configure `AGENTIX_LLM_TIMEOUT_MS`, `AGENTIX_LLM_MAX_ATTEMPTS`, and `AGENTIX_LLM_RETRY_DELAY_MS` when needed. Authentication and other permanent 4xx errors are not retried. Provider failures remain failed tasks and never become synthetic successful answers.

Plans are persisted as soon as planning completes and updated while tasks launch. On restart, Powerhouse reconstructs completed outputs, reuses interrupted open tasks, and continues newly unblocked dependent steps. When an approval is granted, the same continuation path resumes from completed step IDs. `retry-failed` creates a new attempt for failed work and then runs its dependents instead of retrying an isolated task.

## Healing

Repeated task failures create candidate healing procedures. After the same normalized failure repeats enough times, Agentix can auto-promote the procedure into retry guidance. Promoted procedures are applied during retryable Symphony steps by injecting procedure guidance into the next Pi-agent attempt and recording `healing.procedure_applied` in the audit log. Successful and failed applications update procedure counters; procedures that repeatedly fail without success are auto-deprecated. This does not bypass approval gates; shell, code-edit, and sandbox steps still require approval before execution.

## Dynamic Pi Profiles

Use `agentix agents` or `/agents/profiles` to manage command-backed Pi agents. Profiles are stored in `data/agents/profiles.json`, are loaded at backend startup, and are approval-gated before execution. The configured command receives task JSON on stdin and should write result text to stdout; non-zero exit codes are treated as task failures.

## Sandbox Isolation

`sandbox-run` uses `AGENTIX_SANDBOX_MODE=auto` by default. When Docker and the configured image are available, Agentix runs sandbox code through `docker run --network none` with CPU, memory, and PID limits. If Docker or the image is not available, `auto` falls back to the local sandbox runner with command allowlisting, stripped env, timeout, and filesystem path guards. Use `AGENTIX_SANDBOX_MODE=docker` for fail-closed container isolation, or `AGENTIX_SANDBOX_MODE=local` when Docker is intentionally unavailable. `AGENTIX_SANDBOX_DOCKER_IMAGE` defaults to `node:22-alpine`.

Process-backed Pi agents terminate their process tree on timeout, cancellation, and Powerhouse shutdown. Captured stdout and stderr are capped per stream by `AGENTIX_PROCESS_OUTPUT_LIMIT_BYTES` (1 MiB by default) to prevent unbounded memory growth. TypeScript validation uses a 60-second bound. Scheduled scripts use the same output cap and `AGENTIX_SCHEDULER_SCRIPT_TIMEOUT_MS` (60 seconds by default); stale persisted `running` locks are cleared and audited on restart.

## Gateways

Inbound gateway webhooks use `POST /gateway/<id>/inbound` and must include `X-Agentix-Gateway-Secret` or `?secret=` matching `AGENTIX_GATEWAY_<ID>_SECRET` or `AGENTIX_GATEWAY_SECRET`. Outbound replies are delivered when platform credentials are configured: `SLACK_BOT_TOKEN` plus channel, `DISCORD_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN` plus chat, or `AGENTIX_GATEWAY_WEBHOOK_URL` for generic webhooks. Delivery is bounded by `AGENTIX_GATEWAY_TIMEOUT_MS` (15 seconds by default), and persisted diagnostics never contain credential-bearing target URLs or remote response bodies. Missing outbound config does not fail task execution; it is reported in gateway delivery metadata and doctor details.

## Health Checks

- `GET /health` on the inbox server
- `GET /health` on the bridge server
- `agentix doctor`, `agentix --agentix-cli doctor`, or `GET /doctor` for Agentix diagnostics
- `agentix readiness` reports private-beta and public-release gates; public release readiness stays false until live credentials and external release publication are verified
- If `AGENTIX_SESSION_TOKEN` is configured, it acts as an admin bearer token for all non-health control endpoints
- Workspace API tokens can be created with `agentix --agentix-cli auth create [viewer|operator|admin] [label]`; plaintext is printed once and hashes persist under `data/auth/tokens.json`
- Role policy: `viewer` can read, `operator` can mutate runtime resources, `admin` can manage config/auth and memory reset
- If neither env token nor workspace token exists, loopback servers run in local dev-open mode; non-loopback binds require a token or explicit `AGENTIX_ALLOW_UNAUTHENTICATED=1`

## Docker

Build and run the production runtime image:

```powershell
docker build -t agentix:local .
$env:AGENTIX_SESSION_TOKEN = "replace-with-a-long-random-token"
docker compose up
```

The root `Dockerfile` starts `agentix server` on `0.0.0.0`, exposes the dashboard on `3000` and bridge on `3456`, persists runtime state in the `agentix-data` volume, and mounts a workspace volume at `/workspace`. `docker-compose.yml` requires `AGENTIX_SESSION_TOKEN` because control APIs are exposed outside loopback.

## Release Smoke

Before publishing a release, run:

```powershell
npm run release:preflight -- --require-llm
npm run build
npm test
npm run smoke:release
npm run release:manifest
npm run verify:llm -- --out data/release/live-llm-proof.json
npm run release:verify -- --out data/release/public-release-proof.json
agentix readiness
```

The release preflight checks that the repository is public, npm authentication is configured, npm publish dry-run succeeds, the npm version is publishable, and the live LLM secret is present when `--require-llm` is used. It accepts `AGENTIX_LLM_API_KEY`, `KILOCODE_API_KEY`, or `KILO_API_KEY` for the live proof. The release smoke packs the npm artifact, installs it into an isolated temporary prefix, proves installer SHA256 success and tamper failure, runs `agentix version`, `agentix help`, `agentix readiness`, and `agentix support`, starts the installed server, verifies both health endpoints, loads `/ui/`, executes a task through the Agentix shell adapter, verifies Agentix config sync, verifies gateway commands, runs a scheduler job, and creates a support bundle. The release manifest writes a tarball checksum file under `.release/`; use `AGENTIX_EXPECTED_SHA256` with `install.sh` or `install.ps1` for verified tarball installs. `npm run verify:llm` makes a live provider call and writes `data/release/live-llm-proof.json`; `agentix readiness` requires that proof for public-release readiness. After the tag is published, `npm run release:verify` checks npm metadata, npm provenance attestation metadata, isolated `npm install -g`, GitHub release manifest, release tarball SHA256, and installer dry-run. With `--out data/release/public-release-proof.json`, `agentix readiness` can verify the public release proof instead of relying on a manual claim; the proof must include npm registry metadata, npm provenance, installed CLI verification, and public GitHub release assets. Tag pushes matching `v*.*.*` run `.github/workflows/release.yml`, publish with `npm publish --provenance`, upload the tarball plus manifest as GitHub release assets only after npm publish succeeds, generate public release proof, optionally generate live LLM proof when `AGENTIX_LLM_API_KEY` or `KILOCODE_API_KEY` secret exists, and upload proof JSON files as workflow artifacts plus release assets.

## Support Bundle

Use `agentix support` to create a timestamped bundle under `data/support/` with:

- manifest metadata
- sanitized config
- sessions, tasks, approvals, jobs, gateways, dynamic agent profiles, audit, healing, doctor, and memory snapshots
- plan execution snapshots
- recursively redacted logs and nested runtime values, including authorization/cookie/token/password fields and configured secret values

## Recovery

- Stop the running shell before upgrading the launcher
- Keep workspace config files in place during upgrades
- If the bridge is down, restart it with `agentix server`
- If `agentix doctor` reports corrupt state, generate a support bundle before removing the preserved `.corrupt-*` backup

