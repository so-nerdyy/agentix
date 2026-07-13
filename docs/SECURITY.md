# Security

## Threat Model

Agentix assumes the local workspace may contain untrusted inputs, scripts, and task outputs. The backend should treat all external content as untrusted until validated.

## Secrets

- API keys should come from environment variables, secret managers, or the Agentix workspace `.env.local`
- Secrets are not persisted to Agentix `data/config.json`
- `agentix setup` and `agentix model` sync only non-secret provider/model defaults into Agentix backend config
- Setup and runtime config writes use private atomic files where the platform supports POSIX modes; malformed JSON is preserved as `.corrupt-*` evidence before replacement
- Session tokens should be scoped to the current workspace or deployment
- When `AGENTIX_SESSION_TOKEN` is set, inbox/dashboard control APIs, bridge control APIs, and event streams require `Authorization: Bearer <token>` or `?token=<token>` for SSE
- Workspace API tokens support `viewer`, `operator`, and `admin` roles; token hashes are stored under `data/auth/tokens.json`, and plaintext tokens are shown only once at creation
- Non-loopback API binds such as `0.0.0.0` are refused unless `AGENTIX_SESSION_TOKEN`, an active workspace token, or `AGENTIX_ALLOW_UNAUTHENTICATED=1` is explicitly configured
- Use `agentix --agentix-cli auth create admin <label>` before exposing the API to another machine, then use that bearer token from dashboard/API clients

## Execution Boundaries

- Pi workers run backend-approved work
- Approval-gated actions must remain explicit in the backend
- Shell/UI layers must not become a second source of truth for task state
- `bash`, `code-edit`, and `sandbox-run` task kinds are approval-gated by default
- `code-edit` task paths are restricted to the configured project root
- `sandbox-run` task files are restricted to the task sandbox directory, commands are limited to an allowlist, and child process environment is stripped
- Sandbox isolation mode defaults to `auto`: Agentix uses Docker with `--network none`, CPU/memory/PID limits, and a bind-mounted workspace when Docker and the configured image are available; otherwise it falls back to the local filesystem/process boundary
- Set `AGENTIX_SANDBOX_MODE=docker` to require Docker isolation and fail closed when Docker is unavailable; set `AGENTIX_SANDBOX_DOCKER_IMAGE` to choose the runtime image
- Scheduled script jobs are restricted to configured script directories and run with a reduced environment; treat them as trusted automation, not untrusted code execution
- Process-backed Pi, validation, scheduler, and gateway work is timeout/output bounded; cancellation terminates process trees
- Dashboard responses include a self-only content-security policy, frame denial, MIME-sniffing prevention, and a no-referrer policy

## Validation

- Validate tool arguments before execution
- Validate file paths before writing artifacts
- Validate update/install instructions before mutating config

## Operational Checklist

- Keep Node and Python dependencies current
- Review gateway credentials before enabling integrations
- Rotate session tokens if dashboard, bridge, or event stream access is suspected to be exposed
- Revoke workspace tokens with `agentix --agentix-cli auth revoke <token-id>`
- Review `agentix doctor` state-integrity warnings and create a support bundle before deleting corrupt-state backups

