# PHASE 1 — MVP: CLI + Hermes Shell + HTTP Bridge

**Goal:** A working CLI (`agentix`) that routes through a TypeScript HermesShell to a Python backend via an HTTP bridge. Slash commands delegate to Python CLI for real product behavior.

> ⚠️ **Current status: MVP STUB (partially complete).** The basic infrastructure exists, but several components described in this plan are stubs or not yet implemented. See status section below.

---

## What IS Built (verified)

### 1. CLI Entry Point (`src/cli.ts`)
- `#!/usr/bin/env node` shebang for global install
- Auto-checks `127.0.0.1:3456/health` and spawns bridge if needed
- Imports and uses `AgentixBackend`

### 2. Hermes Shell (`src/shell/HermesShell.ts`)
- Interactive readline interface
- Non-slash input goes through `AgentixBackend.executeStream()` (streaming HTTP)
- Slash commands: `/new`, `/reset`, `/status`, `/history`, `/help`
- Delegates to Python CLI via `hermesCommand()`: `/doctor`, `/usage`, `/setup`, `/model`, `/update`, `/cron`, `/gateway`, `/sessions`, `/skills`, `/tools`, `/memory`, `/logs`
- Local responses: `/theme`, `/personality`, `/fortune`

### 3. HTTP Bridge Server (`src/bridge/server.ts` + `entry.ts`)
- Fastify server on `127.0.0.1:3456`
- `GET /health` → `{ status: "ok", backend: "hermes" }`
- `POST /execute/stream` → SSE streaming passthrough to Python backend
- `POST /execute` → non-streaming fallback
- Session management: `GET/POST/DELETE /sessions`
- `GET /memory/search`, `GET /tools`
- Proper SSE formatting with `\n` escaping

### 4. TypeScript Client (`src/agentix_backend.ts`)
- `AgentixBackend` class: `execute()`, `executeStream()` (callback streaming)
- `listSessions()`, `createSession()`, `deleteSession()`, `memorySearch()`, `listTools()`
- Bridge URL from env var or default `127.0.0.1:3456`

### 5. Python Backend Stubs (`hermes-agent/`)
- `agentix_backend.py` — `AgentixBackend` class with `ensure_bridge_running()`, HTTP client to bridge, SSE streaming
- `run_agent.py` — `AIAgent` stub; rebinds to `AgentixBackend` when `AGENTIX_FRONTEND=hermes`
- `cli.py` — CLI stub that tries to delegate to `hermes_cli.main`, errors if not available
- `hermes_cli/main.py` — placeholder stub (delegates to cli.py)

### 6. Path Configuration (`src/config/paths.ts`)
- Central `PATHS` object: `projectRoot`, `hermesAgent`, `hermesCLI`, `bridgeEntry`
- Uses `import.meta.url` + `fileURLToPath` for reliable resolution

### 7. Python Bridge (`src/shell/hermes_python_bridge.ts`)
- `hermesCommand(subcommand, args, timeoutMs)` — spawns Python CLI, returns stdout
- Timeout and abort signal support

### 8. Bin Wrapper (`bin/agentix.js`)
- Wraps `dist/cli.js` for the `bin` field in `package.json`

### 9. TypeScript Build (`tsconfig.json`)
- ESM output, `moduleResolution: "bundler"`
- OutDir: `dist/`, `"rootDir": "."`
- `npm run build` → `tsc` → `dist/` (8 .js files)
- **Version: 2.1.0** (per `package.json`)

---

## What is NOT Built (stub only or missing)

| Component | Status | Notes |
|---|---|---|
| `src/powerhouse/Powerhouse.ts` | ❌ Missing | Not written yet |
| `src/config/InboxServer.ts` | ❌ Missing | HTTP server on port 3000 for web UI |
| `src/config/EventBus.ts` | ❌ Missing | Event emitter for agent communication |
| `src/shell/TerminalBridge.ts` | ❌ Missing | Hermes-class rich terminal UX |
| `src/healing/FailurePatternStore.ts` | ❌ Missing | Pattern-based failure diagnosis |
| `src/pi/*` (PI agents) | ❌ Missing | SandboxAgent, BashAgent, CodeAgent |
| `src/memory/MemoryStore.ts` | ❌ Missing | ChromaDB or JSON-file memory |
| `tests/` directory | ❌ Missing | No test suite exists yet |
| `frontend/` directory | ❌ Missing | No React web UI |
| `Dockerfile`, `docker-compose.yml` | ❌ Missing | No container build |
| `docs/OPERATIONS.md`, `docs/SECURITY.md` | ❌ Missing | No ops/security docs |
| `package.json` complete fields | ⚠️ Partial | Missing `files`, `publishConfig`, `repository` |

---

## Architecture (current stub)

```
agentix shell
    │
    ▼
src/cli.ts
    │
    ├─ checks 127.0.0.1:3456/health
    │   └─ spawns bridge if not running
    │
    ▼
HermesShell.start()  [src/shell/HermesShell.ts]
    │
    ├─ "/" commands → hermesCommand() → python cli.py
    │
    └─ non-slash → AgentixBackend.executeStream()
                        │
                        ▼
                   HTTP POST /execute/stream
                        │
                        ▼
              Fastify bridge [src/bridge/server.ts]
                        │
                        ▼
              Python AgentixBackend [hermes-agent/]
                        │
                        ▼
              SSE stream back to client
```

---

## Exit Criteria (what needs to be true for Phase 1 complete)

- [ ] `npm run build` produces clean `dist/` — 0 TypeScript errors ✅ (verified)
- [ ] `npm install -g .` → `agentix --version` works ✅ (verified)
- [ ] `agentix --help` shows all commands ✅ (verified)
- [ ] `agentix doctor` runs system diagnostic
- [ ] Interactive shell: type message → get streamed response → `/new` starts new session
- [ ] `GET /health` on port 3456 returns `200 { status: "ok", backend: "hermes" }`
- [ ] All slash commands respond (delegate to Python or local response)
- [ ] `src/powerhouse/Powerhouse.ts` exists and compiles
- [ ] `src/config/InboxServer.ts` exists and serves `/health`
- [ ] `src/config/EventBus.ts` exists with typed events
- [ ] `src/shell/TerminalBridge.ts` exists with ANSI colors
- [ ] `src/healing/FailurePatternStore.ts` exists
- [ ] `tests/` directory exists with passing test suite
- [ ] `frontend/` directory exists and builds
- [ ] `Dockerfile` and `docker-compose.yml` exist and work
- [ ] `docs/OPERATIONS.md` and `docs/SECURITY.md` exist

---

## Status

**MVP STUB — partial implementation.** The foundational architecture (CLI, shell, bridge server, Python stubs, path config) is in place and working. The core Agentix components (Powerhouse, EventBus, InboxServer, TerminalBridge, healing layer, PI agents, tests, frontend, Docker) have NOT been built yet. This plan serves as the roadmap for completing Phase 1 properly.