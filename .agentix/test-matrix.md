# Agentix Capability Test Matrix

Statuses: `PASS` is directly proven. `PARTIAL` has meaningful evidence but an
end-to-end or ownership gap remains. `GAP` is not implemented correctly. `EXTERNAL`
requires credentials, publication, or unavailable platform infrastructure.

| Capability | Status | Evidence |
| --- | --- | --- |
| Public npm install | PASS | `2.1.12` public install; `2.2.0` packed isolated-prefix install |
| Cold launch and prompt | PARTIAL | Installed non-TTY shell under 1.5s; interactive TTY selects packaged TUI; PTY proof pending |
| Help/version/invalid command | PASS | Real subprocess tests; unknown command exits 2 locally without compatibility runtime |
| Graceful exit and Ctrl+C | PARTIAL | Installed shell and TUI proxy provider abort paths pass; real interactive PTY keypress proof remains |
| Complete slash-command inventory | GAP | Backend shell inventory passes, but current upstream has 13 additional commands and TUI still uses Hermes slash worker |
| Full-screen TUI | PARTIAL | 85 files/896 tests, type-check, bundle, source and packed non-TTY launch pass; PTY/platform proof pending |
| TUI lint | GAP | Full vendored tree currently reports 38 errors and 102 warnings |
| TUI backend ownership | GAP | Prompt path uses Agentix; session DB and slash worker still use Hermes state/dispatch |
| Narrow/color-disabled terminal | PASS | Non-TTY smoke has no ANSI; mobile dashboard 390x844 has no overflow |
| Config precedence and aliases | PASS | Process > `.env.local` > JSON > defaults; Kilo aliases covered |
| Malformed configuration | PASS | Tolerant load plus `doctor` fail/warn diagnostics with no content leak |
| Private/atomic setup | PASS | 0600 where supported, atomic replace, corrupt config backup, secret masking |
| Unsupported/invalid provider | PASS | Actionable failed task; no diagnostic success fallback |
| Authentication errors | PASS | 401/403 non-retry, safe message, no key/remote-body leak |
| Provider timeout/retry/cancel | PASS | Hanging headers and body, transient retry, external abort tests |
| Native provider streaming | PASS | OpenAI SSE unit proof and real Kilo `STREAM_OK` in two deltas |
| Real primary model request | PASS | Live Kilo catalog and completion proof with corrected model ID |
| Symphony planning/lifecycle | PASS | Static/LLM plans, visible progress, task/plan persistence, validation |
| Parallel independent steps | PASS | Bounded concurrency and stable plan-order aggregation tests |
| Dependency synthesis context | PASS | Completed dependency outputs supplied to downstream step test |
| Luna delegation | PASS | Unit routing plus real `luna-message` / `LIVE_LUNA_OK` |
| Terra delegation | PASS | Unit routing plus real `terra-message` / `LIVE_TERRA_OK` |
| Dynamic command Pi profiles | PASS | CRUD, registration, approval, execution, output/error tests |
| Approval pause/resume/reject | PASS | Persisted continuation, timeout, direct reject, plan/sibling cancellation |
| Task/plan cancellation | PASS | Queued/running/approval cancellation; no retry after cancel; monotonic terminal state |
| Retry/healing | PASS | Retries, failed-plan continuation, promotion/use/feedback/deprecation |
| Shutdown/restart recovery | PASS | Active checkpoint, interrupted plan recovery, dependent continuation |
| Session transcript/history | PASS | Atomic transcript persistence, restart recovery, shell `/history` release smoke |
| Corrupt/partial state | PASS | Atomic stores, preserved `.corrupt-*` backup, bounded doctor integrity scan |
| Process safety | PASS | Missing executable, timeout, process-tree abort, output cap, spaces, path guards |
| Scheduler/cron | PARTIAL | Backend recurrence/one-shot/manual/due/recovery pass; TUI slash ownership pending |
| Memory | PARTIAL | Backend persistence/search/consolidation/reset pass; complete Agentix TUI workflow pending |
| Skills/plugins/MCP | GAP | Hermes metadata is suppressed until Agentix-owned lifecycle and Pi integration exist |
| Gateway framework/webhook | PASS | Auth, parsing, enable/disable, inbound, outbound, timeout/redaction, browser workflow |
| External Slack/Teams/Discord/Telegram | EXTERNAL | Connectors implemented; live channel credentials are not present locally |
| Dashboard | PASS | All 18 panels/actions manually exercised desktop/mobile; no console errors |
| HTTP auth/RBAC/input validation | PASS | Viewer/operator/admin tests, safe bind, signed inbound, malformed execution 400s |
| Browser security headers | PASS | CSP, frame denial, MIME sniffing, and referrer policy integration test |
| Secret handling/support bundle | PASS | Recursive sentinel scan across config/tasks/memory/logs; private output files |
| Dependency security | PASS | `npm audit`: zero vulnerabilities |
| Windows current branch | PASS | Local and PR #21 CI build, 181 tests, packed install/smoke, PowerShell installer |
| Ubuntu current branch | PASS | PR #21 CI build, 181 tests, packed install/smoke, shell installer |
| macOS current branch | GAP | Workflow added; no final macOS CI evidence yet |
| Docker current branch | PASS | PR #21 CI primary/compatibility image builds plus Linux/Windows compose validation |
| Documentation install path | PARTIAL | TUI/parity docs updated; final command/session ownership changes still pending |
| npm/GitHub provenance | PASS | Public `2.1.12` proof; workflow enforces provenance for subsequent tags |
| `2.2.0` public publication proof | EXTERNAL | Requires merge/tag authorization, npm publish, and GitHub release assets |
