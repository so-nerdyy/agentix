# PHASE 4 — Final Polish: Frontend UI + Release Packaging + Documentation

**Goal:** Ship Agentix as a coherent product with a web UI, Docker Compose deployment, operations runbook, security review, and release-ready packaging.

> ⚠️ **Current status: NOT STARTED.** No frontend, no Docker files, no docs exist yet. All of this needs to be built.

---

## What Needs to Be Built

### 1. Frontend Web UI (`frontend/`)
React web interface served by InboxServer on port 3000. **Does not exist yet.**

#### Tech Stack
- React 18+ with hooks
- Vite as bundler
- TypeScript throughout
- CSS modules or design tokens (no Tailwind)

#### Pages
- `/ui` — main dashboard: session list, active task, terminal output
- `/ui/sessions/:id` — session detail: task history, memory, tools
- `/ui/tasks/:id` — task detail: full output log, retry button, approval buttons
- `/ui/logs` — searchable log viewer
- `/ui/settings` — model config, approval preferences

#### Features
- Real-time task progress via SSE `/events` stream
- Approval buttons for pending tasks (no CLI needed)
- Session management (create, switch, close)
- Dark theme matching terminal aesthetic

#### Auth (`frontend/src/hooks/useAuth.ts`)
- Session token via `?token=` query param or `Authorization: Bearer <token>` header
- Token matches `AGENTIX_SESSION_TOKEN` env var
- **Note:** Uses `React.createElement` instead of JSX to avoid TypeScript 5.9 JSX parser bug in strict mode

### 2. Dockerfile (Multi-stage build)
**Does not exist yet.**

```dockerfile
# Build stage: full deps so TypeScript + Vite can compile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci                          # full deps (TS/Vite needed for build)
COPY . .
RUN npm run build                   # tsc + vite build

# Prune devDeps before copying to runtime
WORKDIR /app
RUN npm ci --omit=dev               # removes TS/Vite/etc from node_modules

# Runtime stage: lean production image
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json .
EXPOSE 3000 3456
HEALTHCHECK CMD curl -f http://localhost:3000/health
ENTRYPOINT ["node", "dist/bridge/entry.js"]
```

### 3. docker-compose.yml
**Does not exist yet.**

```yaml
services:
  agentix:
    build: .
    ports:
      - "3000:3000"   # InboxServer (web UI)
      - "3456:3456"   # Bridge server
    volumes:
      - agentix_sandboxes:/app/data/sandboxes
      - agentix_memory:/app/data/memory
      - agentix_vault:/app/data/vault
    environment:
      - AGENTIX_BRIDGE_PORT=3456
      - AGENTIX_MODEL=${AGENTIX_MODEL}
      - AGENTIX_LLM_API_KEY=${AGENTIX_LLM_API_KEY}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped

volumes:
  agentix_sandboxes:
  agentix_memory:
  agentix_vault:
```

### 4. docs/OPERATIONS.md
**Does not exist yet.**

#### Contents
- **Startup procedure** — `npm install -g` → `agentix server` → health check
- **Log locations** — `data/logs/`, stdout, Docker logs
- **Backup/restore** — what to back up (sessions, memory, vault), restore procedure
- **Scaling** — session affinity, event bus clustering
- **Graceful shutdown** — `agentix stop`, `SIGTERM` handling, drain timeout
- **Upgrade path** — version upgrade, migration, rollback plan
- **Support bundle** — `agentix support` generates `agentix-support-<timestamp>.zip`:
  - Session state (`data/sessions/*.json`)
  - Recent logs (last 24h)
  - Config (sanitized, no secrets)
  - Sandbox metadata (not full sandbox contents)
  - Build info (version, Node version, platform)
- **Common failures** — ENOENT, EADDRINUSE, ENOMEM, auth failures

### 5. docs/SECURITY.md
**Does not exist yet.**

#### Contents
- **Threat model** — attack surface (network ports, filesystem, env vars)
- **RBAC matrix** — what each role (owner, operator, user) can do
- **Credential handling** — API keys never written to disk, env var only
- **Input validation** — sanitize all user input before PI agents
- **Sandbox isolation** — filesystem boundaries, network restrictions, resource limits
- **Security checklist**:
  - [ ] API keys not in committed config files
  - [ ] `AGENTIX_LLM_API_KEY` loaded from env at runtime only
  - [ ] Sandbox directories not accessible outside session scope
  - [ ] EventBus events don't leak sensitive data to unauthenticated clients
  - [ ] `/events` SSE endpoint requires valid session token
  - [ ] CORS disabled on both ports
  - [ ] No `eval()` or arbitrary code execution outside sandbox

### 6. package.json — Complete Fields
Currently missing `files`, `publishConfig`, `repository`:
```json
{
  "name": "agentix",
  "version": "2.1.0",
  "files": ["dist/", "bin/", "frontend/dist/", "hermes-agent/"],
  "publishConfig": { "registry": "https://npmjs.org" },
  "repository": { "type": "git", "url": "https://github.com/agentix/agentix" },
  "keywords": ["agent", "ai", "hermes", "coding-agent", "claude"]
}
```

---

## Architecture (full system — what needs to exist)

```
                                    ┌─────────────────────────┐
                                    │   User's Browser        │
                                    │   http://localhost:3000 │
                                    └────────────┬────────────┘
                                                 │ HTTP + SSE
                    ┌────────────────────────────▼────────────┐
                    │        InboxServer (:3000)               │
                    │  GET /health    GET /ui/*                │
                    │  GET /events (SSE, auth)                 │
                    │  serves frontend/dist/                   │
                    └────────────────────┬────────────────────┘
                                         │ EventBus
                    ┌────────────────────▼────────────────────┐
                    │       EventStreamBridge (:3000)          │
                    │  Bridges EventBus → SSE /events          │
                    └────────────────────┬────────────────────┘
                                         │ EventBus
                    ┌────────────────────▼────────────────────┐
                    │          Powerhouse                      │
                    │  SessionCoordinator                      │
                    │  TaskQueue + ApprovalWorkflow            │
                    │  SelfHealingEngine                       │
                    │  PI Agent Registry                       │
                    └────────────────────┬────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        │                                │                                │
        ▼                                ▼                                ▼
 ┌─────────────┐                 ┌─────────────┐                 ┌─────────────┐
 │ SandboxAgent│                 │  BashAgent  │                 │  CodeAgent  │
 └─────────────┘                 └─────────────┘                 └─────────────┘

 ┌────────────────────────────────────────────────────────────────────────────┐
 │                         HTTP Bridge (:3456)                                 │
 │  POST /execute/stream → proxies to Python backend → SSE response           │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌────────────────────────────────────────────────────────────────────────────┐
 │                      hermes-agent/ (Python backend)                         │
 │  agentix_backend.py — auto-spawns bridge, HTTP client                       │
 │  run_agent.py — AIAgent stub, rebinds to AgentixBackend                    │
 │  cli.py — CLI entry, delegates to hermes_cli.main                          │
 └────────────────────────────────────────────────────────────────────────────┘
```

---

## Exit Criteria

- [ ] `docker build -t agentix:2.1.0 . && docker run agentix:2.1.0 --version` succeeds on a machine with Docker
- [ ] `docker-compose up` starts full stack with healthcheck
- [ ] Web UI at `http://localhost:3000/ui` shows session list and real-time event stream
- [ ] `GET http://localhost:3000/health` → `200 { status: "ok", ... }`
- [ ] `GET http://localhost:3456/health` → `200 { status: "ok", backend: "hermes" }`
- [ ] `npm install -g .` → `agentix --version` → `2.1.0` → `agentix doctor` passes
- [ ] `agentix support` generates downloadable support bundle
- [ ] `docs/OPERATIONS.md` covers startup, logging, backup, scaling, shutdown, upgrade, support bundle
- [ ] `docs/SECURITY.md` covers threat model, RBAC, credential handling, sandbox isolation, checklist
- [ ] TypeScript: 0 errors
- [ ] Tests exist and pass
- [ ] **Positioning: "Agentix is a Hermes-class agent platform in private beta"**

---

## Status

**NOT STARTED.** Phase 4 is the final packaging and documentation phase. The core architecture (Powerhouse, EventBus, TerminalBridge, healing engine) needs to be built in Phases 2 and 3 first. The current codebase is a Phase 1 MVP stub with 8 TypeScript files and Python stubs. Phase 4 completes the product story once the foundation is in place.