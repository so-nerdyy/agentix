# API

Agentix exposes the same backend contract from both runtime servers:

- Inbox/dashboard server: `http://127.0.0.1:3000`
- Bridge server: `http://127.0.0.1:3456`

OpenAPI contract:

```text
GET /openapi.json
```

Authentication:

- `GET /health` and `GET /openapi.json` are public.
- Env `AGENTIX_SESSION_TOKEN` works as an admin bearer token.
- Workspace API tokens can be created with `agentix --agentix-cli auth create [viewer|operator|admin] [label]`.
- Stored workspace tokens are hashed under `data/auth/tokens.json`; plaintext is returned once at creation.
- Role policy: `viewer` can read, `operator` can mutate runtime resources, `admin` can manage config/auth and reset memory.
- If no env token or workspace token exists, loopback-only servers run in local dev-open mode.
- Non-loopback binds such as `0.0.0.0` require `AGENTIX_SESSION_TOKEN`, an active workspace token, or `AGENTIX_ALLOW_UNAUTHENTICATED=1` for explicit development override.

Core endpoint groups:

- Powerhouse execution: `/execute`, `/execute/stream`
- Auth: `/auth/status`, `/auth/tokens`
- Symphony plans: `/plans`, `/plans/{id}`
- Pi agents/tools: `/tools`, `/tools/{id}`
- Tasks and approvals: `/tasks`, `/approvals`
- Memory: `/memory`, `/memory/search`, `/memory/consolidate`, `/memory/reset`
- Scheduler/cron: `/scheduler/jobs`, `/scheduler/run-due`
- Gateways: `/gateway`
- Healing: `/healing/stats`, `/healing/detail/{id}`, `/healing/procedures/{id}/promote`, `/healing/procedures/{id}/deprecate`. Procedure detail includes use/success/failure counters, auto-promotion time, and deprecation reason.
- Pi agent profiles: `/agents/profiles`, `/agents/profiles/{id}/enable`, `/agents/profiles/{id}/disable`. Dynamic profiles run configured commands as approval-gated Pi agents and receive task JSON on stdin.
- Runtime support: `/doctor`, `/usage`, `/logs`, `/audit`, `/support/bundle`, `/events`

Use `agentix server` for the full dashboard/API runtime, or `agentix --agentix-cli server` when bypassing the Hermes frontend wrapper.
