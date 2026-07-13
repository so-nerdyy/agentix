# Changelog

All notable Agentix changes are documented here.

## 2.2.0 - 2026-07-12

### Added

- Configured Luna and Terra Pi agents with Symphony routing and setup/doctor support.
- Native OpenAI-compatible and Anthropic streaming through the terminal event path.
- Bounded parallel Symphony waves with dependency-result context.
- Persisted session transcripts, plan recovery, failed-plan retry, and resumed history.
- Corrupt-state backups and configuration/state integrity diagnostics.
- Browser security headers and complete dashboard/runtime control coverage.

### Changed

- The installed launcher now emits immediate feedback from a thin cold-start bootstrap.
- Kilo first-run setup defaults to the live-catalog `kilo-auto/free` model.
- Provider, Pi, code-validation, scheduler, and gateway operations are bounded and cancellable.
- Unknown public commands fail locally instead of exposing vendored compatibility commands.
- Setup/config writes and JSON stores use private atomic replacement where supported.

### Fixed

- Running and approval-waiting task cancellation now closes the parent plan and siblings.
- Approval rejection/timeout no longer leaves plans paused indefinitely.
- Provider failures no longer become synthetic successful answers.
- Timeouts remain active after HTTP headers while provider bodies are read.
- Cancelled steps no longer enter retry/recovery loops.
- Scheduler crashes no longer leave permanent `running` locks; script output is capped.
- Gateway responses no longer expose credential-bearing URLs or remote error bodies.
- Shell session history and plan detail rendering now match backend contracts.
- Dashboard command palette, compose, approvals, bodyless actions, forms, counters, and stale details.
- Support bundles redact nested credentials, authorization values, bearer tokens, and URL passwords.
