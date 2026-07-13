# Agentix Engineering Progress

Updated: 2026-07-12

## Repository State

- Worktree: `C:\Users\carth\Downloads\agentix-release-2.1.1`
- Branch: `codex/orchestration-hardening-2.2.0`
- Base: `v2.1.12` / `f596efb`
- Public package: `@nerdyy/agentix@2.1.12`
- Release candidate: `2.2.0`
- The divergent checkout at `C:\Users\carth\Downloads\agentix` was not modified.

## Current Evidence

- Build: pass (`tsc` plus dashboard build).
- Automated suite: 23 files, 181 tests passed.
- Dependency audit: zero known vulnerabilities across 149 dependencies.
- Final packed `2.2.0` release smoke: pass in 312.5 seconds.
- Installed cold launch: immediate bootstrap, under the 500 ms gate, no piped ANSI.
- Installed Ctrl+C: provider request aborted; task and plan persisted `cancelled`;
  no orphan shell/backend process.
- Real Kilo Luna/Terra: `luna-message` returned `LIVE_LUNA_OK`; `terra-message`
  returned `LIVE_TERRA_OK`; both plans completed.
- Real Kilo streaming: `STREAM_OK`, two native deltas, successful completion.
- Browser dashboard: all 18 panels, auth, compose, approval execution, scheduler
  recurrence/manual run, search, memory, gateway enable/disable, doctor, support,
  session, and token create/revoke passed; mobile 390x844 passed; zero console errors.
- Invalid command: local exit status 2, Agentix-only error, no bridge/Python startup.
- Full slash-command inventory: real isolated shell subprocess passed.
- PR #21 CI: Ubuntu and Windows build, 181 tests, packed release
  smoke, and native installer dry runs passed; primary/compatibility Docker images
  and Linux/Windows compose validation passed.
- CI and release workflows use current Node-runtime action majors and no longer run
  duplicate push plus pull-request matrices for the same branch SHA.
- Release preflight: repository/package/LLM checks pass; local npm auth intentionally
  remains unavailable because `NPM_TOKEN` is stored only as a GitHub Actions secret.

## Defects Closed In This Cycle

- LLM requests now retain timeout/cancellation through response-body reads, retry
  transient failures only, redact errors, and consume native provider SSE.
- Powerhouse cancellation closes plans and sibling approvals atomically; late task
  callbacks cannot reopen cancelled plans or retry cancelled work.
- Interrupted running work checkpoints to queued state and resumes by plan/step.
- Session transcripts persist and shell history resumes; closed sessions reactivate
  only when new work resumes them.
- Corrupt JSON state receives a protected forensic backup; doctor reports malformed
  config/state without exposing content.
- Code validation, scheduler scripts, Pi processes, and gateway delivery are bounded.
- Scheduler stale locks recover after restart; truncated output is explicit.
- Setup writes private files atomically and preserves malformed config; Kilo defaults
  to the currently verified `kilo-auto/free` catalog entry.
- Dashboard interaction blockers, stale details, bodyless POSTs, form races, task
  counts, approval-plan terminal state, and mobile behavior were fixed.
- Support bundles recursively redact configured and structural secrets; auth and
  gateway comparisons are constant-time.

## Next Action

1. Review and merge PR #21.
2. Publish only through the authorized tag workflow, then generate fresh public
   release proof for `2.2.0`.

## Subagent Activity

- No parallel coding agents modified this worktree.
- Luna/Terra product paths were validated as runtime Pi agents with real Kilo calls.
