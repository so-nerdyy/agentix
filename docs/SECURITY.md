# Security

## Threat Model

Agentix assumes the local workspace may contain untrusted inputs, scripts, and task outputs. The backend should treat all external content as untrusted until validated.

## Secrets

- API keys should come from environment variables or secret managers
- Secrets are not persisted to the workspace config file
- Session tokens should be scoped to the current workspace or deployment
- When `AGENTIX_SESSION_TOKEN` is set, inbox/dashboard control APIs, bridge control APIs, and event streams require `Authorization: Bearer <token>` or `?token=<token>` for SSE

## Execution Boundaries

- Pi workers run backend-approved work
- Approval-gated actions must remain explicit in the backend
- Shell/UI layers must not become a second source of truth for task state
- `bash`, `code-edit`, and `sandbox-run` task kinds are approval-gated by default
- `code-edit` task paths are restricted to the configured project root
- `sandbox-run` task files are restricted to the task sandbox directory
- The sandbox is a local filesystem boundary, not container or kernel-level isolation

## Validation

- Validate tool arguments before execution
- Validate file paths before writing artifacts
- Validate update/install instructions before mutating config

## Operational Checklist

- Keep Node and Python dependencies current
- Review gateway credentials before enabling integrations
- Rotate session tokens if dashboard, bridge, or event stream access is suspected to be exposed

