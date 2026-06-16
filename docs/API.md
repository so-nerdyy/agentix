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
- All other control endpoints require `Authorization: Bearer <AGENTIX_SESSION_TOKEN>` when a session token is configured.
- Non-loopback binds such as `0.0.0.0` require `AGENTIX_SESSION_TOKEN` unless `AGENTIX_ALLOW_UNAUTHENTICATED=1` is explicitly set for development.

Core endpoint groups:

- Powerhouse execution: `/execute`, `/execute/stream`
- Symphony plans: `/plans`, `/plans/{id}`
- Pi agents/tools: `/tools`, `/tools/{id}`
- Tasks and approvals: `/tasks`, `/approvals`
- Memory: `/memory`, `/memory/search`, `/memory/consolidate`, `/memory/reset`
- Scheduler/cron: `/scheduler/jobs`, `/scheduler/run-due`
- Gateways: `/gateway`
- Healing: `/healing/stats`, `/healing/detail/{id}`, `/healing/procedures/{id}/promote`
- Runtime support: `/doctor`, `/usage`, `/logs`, `/audit`, `/support/bundle`, `/events`

Use `agentix server` for the full dashboard/API runtime, or `agentix --agentix-cli server` when bypassing the Hermes frontend wrapper.
