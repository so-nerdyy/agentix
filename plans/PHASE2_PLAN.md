# PHASE 2 — Backend Infrastructure: Powerhouse + Session Management + Events

**Goal:** Build the actual Agentix backend orchestration layer (Powerhouse), HTTP server (InboxServer on port 3000), event bus, and event-stream bridge. The HTTP bridge on 3456 proxies to this layer.

> ⚠️ **Current status: NOT STARTED.** None of these components exist yet. This plan describes what needs to be built.

---

## What Needs to Be Built

### 1. InboxServer (`src/config/InboxServer.ts`)
- HTTP server on port **3000** (separate from bridge on 3456)
- `GET /health` — `{ status: "ok", uptime: <seconds>, version: "2.1.0" }`
- Serves the Agentix web UI (`frontend/dist/`)
- Graceful shutdown on `SIGTERM`/`SIGINT`
- CORS disabled (localhost-only)
- Named volume mount: `/app/data` for sandboxes, memory, vault

### 2. EventBus (`src/config/EventBus.ts`)
- Singleton event emitter for internal agent communication
- Typed events:
  - `agent:start`, `agent:complete`, `agent:error`
  - `task:queued`, `task:running`, `task:awaiting-approval`, `task:complete`, `task:rejected`, `task:failed`
  - `session:create`, `session:close`, `session:recover`
  - `powerhouse:start`, `powerhouse:stop`
- `on(event, handler)` / `off(event, handler)` / `emit(event, payload)` API
- Used by Powerhouse to coordinate PI agents

### 3. EventStreamBridge (`src/config/EventStreamBridge.ts`)
- SSE bridge broadcasting EventBus events to web clients
- `GET /events` — SSE stream of all agent events
- Auth: `?token=<session-token>` query param
- Graceful disconnect handling
- Used by `frontend/` for real-time task progress

### 4. Powerhouse (`src/powerhouse/Powerhouse.ts`)
Core orchestration engine. **Does not exist yet** — this is the main piece to build.

#### SessionCoordinator (`src/powerhouse/SessionCoordinator.ts`)
- Manages active sessions and their state
- Session lifecycle: `pending` → `active` → `complete` / `failed`
- Persists state to `data/sessions/` (JSON files)
- Recovery on restart: loads open sessions from disk

#### TaskQueue (`src/powerhouse/TaskQueue.ts`)
- In-memory queue of pending tasks per session
- Priority ordering (user tasks > background tasks)
- Task state machine: `queued` → `running` → `awaiting-approval` → `complete` / `rejected`

#### ApprovalWorkflow (`src/powerhouse/ApprovalWorkflow.ts`)
- Tasks requiring human approval (shell commands, file mutations, external tool use)
- Emits `task:awaiting-approval` on EventBus
- Timeout: tasks waiting > 5 minutes auto-reject with warning
- `agentix approve <task-id>` and `agentix reject <task-id>` CLI commands

#### PI Agent Registry (`src/powerhouse/PIAgentRegistry.ts`)
- Registers available PI agents
- Routes tasks to appropriate PI agent by task type
- PI agents run as forked child processes
- Health monitoring: restart crashed PI agents within 5 seconds

### 5. PI Agents (`src/pi/`)
**None exist yet.**

#### BasePIAgent (`src/pi/BasePIAgent.ts`)
- Abstract base class
- Interface: `execute(task: Task): Promise<TaskResult>`
- Streams output via EventBus as task runs

#### SandboxAgent (`src/pi/SandboxAgent.ts`)
- Executes untrusted code in isolated environment
- Working directory: `data/sandboxes/<session-id>/`
- Resource limits: CPU, memory, wall-clock time
- No network access, no filesystem outside sandbox

#### BashAgent (`src/pi/BashAgent.ts`)
- Executes approved shell commands in project environment
- Working directory: project root
- Streams stdout/stderr via EventBus

#### CodeAgent (`src/pi/CodeAgent.ts`)
- Generates and edits code files
- Reads existing files, applies targeted modifications
- Validates output (TypeScript compilation)

### 6. Memory Store (`src/memory/MemoryStore.ts`)
- ChromaDB-backed vector memory (or JSON-file fallback)
- `index(content, metadata)`, `search(query, topK)`
- Namespace per session
- Automatic summarization for long sessions (> 50 turns)

### 7. Configuration (`src/config/index.ts`)
- Loads from environment variables and `data/config.json`
- `AGENTIX_MODEL`, `AGENTIX_LLM_API_KEY` (env only, not stored)
- `AGENTIX_SESSION_TTL` (default: 24h), `AGENTIX_APPROVAL_TIMEOUT` (default: 5min)
- `AGENTIX_DATA_DIR` — working directory

### 8. New CLI Commands
- `agentix approve <task-id>` — approve a pending task
- `agentix reject <task-id>` — reject a pending task
- `agentix sessions` — list active sessions
- `agentix task list` — list tasks in current session
- `agentix task <id>` — show task details

---

## Architecture (what needs to exist)

```
                    ┌─────────────────────────────────────┐
                    │         Agentix Backend              │
                    │                                      │
  HTTP Bridge       │   Powerhouse                         │
  (3456)            │   ┌──────────────────────────────┐   │
  │                 │   │  SessionCoordinator          │   │
  │                 │   │  TaskQueue                   │   │
  ▼                 │   │  ApprovalWorkflow            │   │
  Fastify           │   │  PI Agent Registry           │   │
  Bridge            │   └──────────────────────────────┘   │
  Server            │          │                           │
  (server.ts)       │          ▼                           │
                    │   ┌──────────────────────────────┐   │
                    │   │  PI Agents                   │   │
                    │   │  [SandboxAgent]              │   │
                    │   │  [BashAgent]                 │   │
                    │   │  [CodeAgent]                 │   │
                    │   └──────────────────────────────┘   │
                    │          │                           │
                    │          ▼                           │
                    │   EventBus ←→ EventStreamBridge      │
                    │       │              │                │
                    │       ▼              ▼                │
                    │   Powerhouse    SSE /events          │
                    │       │              │                │
                    │       ▼              ▼                │
                    │   InboxServer (3000)                  │
                    │   ┌──────────────────────────────┐   │
                    │   │ GET /health                  │   │
                    │   │ GET /events (SSE, auth)      │   │
                    │   │ GET /ui/* (static files)     │   │
                    │   └──────────────────────────────┘   │
                    └─────────────────────────────────────┘
```

**Ports:**
- `3456` — Bridge server (streaming bridge / Python proxy)
- `3000` — InboxServer (web UI + SSE events + health)

---

## Exit Criteria

- [ ] `GET http://localhost:3000/health` → `200 { status: "ok", ... }`
- [ ] `GET http://localhost:3000/events` → SSE stream of agent events (auth required)
- [ ] Powerhouse coordinates PI agents for task execution
- [ ] ApprovalWorkflow pauses task until `agentix approve/reject` called
- [ ] SessionCoordinator persists and recovers sessions
- [ ] `agentix sessions` and `agentix task list` work
- [ ] EventBus events propagate to web UI via EventStreamBridge
- [ ] TypeScript: 0 errors, all new code compiles
- [ ] Tests exist and pass

---

## Status

**NOT STARTED.** This plan describes the complete Phase 2 backend infrastructure. The current codebase has no Powerhouse, no EventBus, no InboxServer, no PI agents, no MemoryStore. All of this needs to be built from scratch.