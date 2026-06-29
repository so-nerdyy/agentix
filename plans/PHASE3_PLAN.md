# PHASE 3 — Self-Healing + Failure Recovery + Hermes-Class UX

**Goal:** Make Agentix recover from failures automatically. Build the healing layer (FailurePatternStore), TerminalBridge for Hermes-class terminal UX, and RecoveryManager for instance-level stability.

> ⚠️ **Current status: NOT STARTED.** None of these components exist yet. This plan describes what needs to be built.

---

## What Needs to Be Built

### 1. FailurePatternStore (`src/healing/FailurePatternStore.ts`)
Pattern-based failure diagnosis and automatic remediation.

#### Pattern Interface
```typescript
interface FailurePattern {
  id: string;
  description: string;
  trigger: {
    type: "exit_code" | "error_message" | "timeout" | "resource_exhausted";
    pattern: RegExp | number;
  };
  context: {
    // Only match failures from active procedures (not deprecated)
    procedureStatus: "active" | "deprecated" | "rolled-back";
  };
  remedy: {
    action: "retry" | "restart_pi_agent" | "escalate" | "skip";
    maxAttempts?: number;
    backoffMs?: number;
  };
  createdAt: Date;
  deprecatedAt?: Date;
}
```

#### Core Methods
- `register(pattern: FailurePattern)` — add a new failure pattern
- `findMatches(failure: FailureContext): FailurePattern[]` — **must skip deprecated procedures**
- `deprecate(patternId: string)` — mark a pattern as deprecated
- `getActive(): FailurePattern[]` — all non-deprecated patterns

#### Built-in Patterns (ship with Agentix)
- `EXIT_CODE_Nonzero` — retry once with 2s backoff
- `ENOTFOUND_import` — retry once, then suggest `npm install`
- `TIMEOUT_long_running` — restart PI agent, retry once
- `OOM_resource_exhausted` — skip task, report to user
- `EADDRINUSE_port` — auto-kill process on port, retry

### 2. SelfHealingEngine (`src/healing/SelfHealingEngine.ts`)
```typescript
on PI agent failure:
  1. Classify failure (exit code, error message, timeout)
  2. Skip deprecated procedures when finding matching patterns
  3. Apply remedy (retry / restart / escalate / skip)
  4. Log recovery action to session event log
  5. If max attempts exceeded → emit task:failed event
  6. After recovery, resume task queue
```
- Dead-letter queue for permanently failed tasks
- Recovery metrics: attempt count, success rate, mean time to recovery
- `GET /healing/stats` on InboxServer

### 3. TerminalBridge (`src/shell/TerminalBridge.ts`)
Rich terminal UX matching Hermes/OpenClaw quality. **Does not exist yet.**

#### ANSI Color System
```typescript
const COLORS = {
  reset: "\u001b[0m",
  bright: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  // Status-specific (MUST match WorkerStepResult type)
  success: "\u001b[32m",  // green for success
  failure: "\u001b[31m",  // red for failure
  warning: "\u001b[33m",
  info: "\u001b[36m",
};
```

#### Task Timeline Renderer
```
[14:32:01] ▶ START   Building project...
[14:32:03] ▶ RUN     npm run build
[14:32:05] ◌ APPROVE Shell command requires approval
           │         /tmp/agentix-task-abc.sh  (4 lines)
           │         [A]pprove  [R]eject  [D]etails
[14:32:09] ✔ APPROVE Approved by user
[14:32:11] ✔ COMPLETE 10.2s — exit 0
```

#### Approval Prompt with Box Drawing
```
┌─ Task requires approval ────────────────────────────────┐
│ Command:  npm test                                      │
│ Duration: ~8s                                           │
│ Risk:     LOW — runs in sandbox                         │
│                                                  [A] [R] [D]│
└────────────────────────────────────────────────────────┘
```

#### Event Icons + Abbreviated IDs
- `▶` Start, `◌` Pending approval, `✔` Success, `✖` Failure, `⚡` System event
- Task IDs abbreviated: `task-abc` (first 8 chars of UUID)
- Session IDs abbreviated: `sess-xyz`

#### ⚠️ Critical Status Type Fix
WorkerStepResult uses `"success"`/`"failure"`, NOT `"complete"`/`"failed"`:
```typescript
// WRONG — these never match WorkerStepResult:
if (step.status === "complete")
if (step.status === "failed")

// CORRECT — must use these:
if (step.status === "success")
if (step.status === "failure")
```
This is the most common bug in Hermes-class shell implementations.

### 4. RecoveryManager (`src/healing/RecoveryManager.ts`)
Instance-level recovery (not just task-level).

#### Stop Sequence (critical — prevents zombie processes and double-delivery)
```typescript
async Powerhouse.stop(): Promise<void> {
  // 1. Stop accepting new tasks
  // 2. Wait for in-flight tasks (max 30s timeout)
  // 3. Emit "powerhouse:stopping" on EventBus
  // 4. Call EventStreamBridge.stop() — remove all SSE subscribers
  // 5. Unsubscribe all EventBus handlers — prevent lingering callbacks
  // 6. Flush session state to disk
  // 7. Kill idle PI agents
  // 8. Emit "powerhouse:stopped"
  // 9. Close network listeners (port 3456, port 3000)
}
```
**Without this sequence:** EventBus handlers linger, EventStreamBridge continues delivering events, double-delivery occurs on instance recreation.

#### Startup Recovery
- Scan `data/sessions/` for sessions in `active` state
- Replay any `queued` tasks that weren't completed (idempotent)
- Check for orphaned sandboxes from previous crashes

### 5. SandboxManager (`src/sandbox/SandboxManager.ts`)
- `create(sessionId: string): string` — creates `data/sandboxes/<session-id>/`
- `destroy(sessionId: string)` — removes sandbox
- `list()` — shows active sandboxes (debugging)
- Resource monitoring: disk usage per sandbox, auto-cleanup > 1GB
- Cleanup on `Powerhouse.stop()`

---

## Exit Criteria

- [ ] `FailurePatternStore.findMatches()` skips deprecated procedures (unit test)
- [ ] SelfHealingEngine retries failed tasks with exponential backoff
- [ ] TerminalBridge renders task timeline with ANSI colors and box-drawing
- [ ] TerminalBridge uses `"success"`/`"failure"` status types (not `"complete"`/`"failed"`)
- [ ] Powerhouse.stop() cleanly tears down all handlers (integration test)
- [ ] Recovery on restart: open sessions recovered, queued tasks replayed
- [ ] `agentix support` generates support bundle
- [ ] TypeScript: 0 errors
- [ ] Tests exist and pass

---

## Status

**NOT STARTED.** None of these components exist. The Python stubs and TypeScript bridge infrastructure from Phase 1 are in place, but the self-healing engine, TerminalBridge, and RecoveryManager need to be built from scratch on top of Phase 2's Powerhouse/EventBus foundation.