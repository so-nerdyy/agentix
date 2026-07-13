# Agentix Production Plan

## Objective

Ship a dependable terminal-first Agentix system in which Powerhouse owns lifecycle
and durable state, Symphony plans and schedules bounded work, and Pi agents execute
subtasks. Configured Luna and Terra models are subordinate Pi workers, not separate
orchestration loops.

## Architecture Boundary

- The `agentix` launcher and shell own immediate feedback, setup, commands, terminal
  rendering, updates, and dashboard entry points.
- Powerhouse owns sessions, task/plan lifecycle, approvals, audit, memory, healing,
  cancellation, persistence, and recovery.
- Symphony owns safe planning, dependencies, bounded parallel waves, validation,
  retries, dependency context, and result aggregation.
- Pi agents own bounded execution. Conversation, Luna, Terra, shell, code, sandbox,
  and dynamic command profiles all report through the same task lifecycle.
- The vendored compatibility runtime supplies selected integrations only. It does
  not own planning, state, or unknown public commands.

## Current State

- Public baseline: `@nerdyy/agentix@2.1.12` with npm provenance and GitHub release.
- Release candidate: `2.2.0` on `codex/orchestration-hardening-2.2.0`.
- A packed global install starts visibly, stays ANSI-clean when piped, creates a
  real backend session, and cancels active work through the full shell/Symphony/Pi
  path.
- Real Kilo requests prove primary connectivity, native streaming, and configured
  Luna/Terra delegation with `stepfun/step-3.7-flash:free`.
- Every dashboard panel/action was exercised in a browser at desktop and mobile
  widths with no console errors or horizontal overflow.
- Local build, 181 automated tests, final packed `2.2.0` release smoke, dependency
  audit, path hygiene, and secret-redaction checks pass. Ubuntu and Docker
  validation run in pull-request CI.

## Release Scope: 2.2.0

1. Provider timeout, retry, cancellation, safe errors, body-read bounds, and native
   OpenAI-compatible/Anthropic streaming.
2. Honest provider failure propagation without synthetic successful responses.
3. Bounded parallel Symphony waves with dependency-result context and stable output.
4. First-class Luna/Terra Pi routing, setup, diagnostics, and real provider proof.
5. Running-task/process-tree cancellation and monotonic task/plan terminal states.
6. Atomic persistence, corrupt-state preservation/diagnostics, plan recovery,
   failed-plan retry, session transcripts, and resumed shell history.
7. Bounded process, code-validation, scheduler, and gateway execution with stale-lock
   recovery and output truncation visibility.
8. Fast cold-start bootstrap, local invalid-command rejection, complete slash-command
   exercise, dashboard fixes, browser security headers, and private atomic setup.
9. Recursive support-bundle redaction, constant-time token checks, and safe gateway
   delivery diagnostics.

## Release Strategy

- Run build, full tests, dependency audit, packed-install smoke, secret scan, and
  patch hygiene locally.
- Push only the `codex/orchestration-hardening-2.2.0` branch and open a pull request.
- Require Windows, Ubuntu, and Docker CI before merge.
- Publish npm/GitHub artifacts only from the authorized release workflow after merge.
- Generate fresh live-LLM and public-release proof files for `2.2.0`; proof files
  from prior versions do not satisfy current readiness.

## Acceptance Criteria

The campaign is complete only when every locally testable row in
`.agentix/test-matrix.md` is `PASS`, pull-request platform gates pass, documentation
matches the packed artifact, and no reproducible critical defect remains. External
channel delivery and public publication require credentials/authorization and are
reported separately rather than represented as local product failures.
