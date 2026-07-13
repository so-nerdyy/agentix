# Agentix Capability Test Matrix

Statuses: `PASS` is directly proven. `EXTERNAL` requires credentials, publication,
or platform infrastructure unavailable in the local environment. No critical local
capability remains `GAP`.

| Capability | Status | Evidence |
| --- | --- | --- |
| Public npm install | PASS | `2.1.12` public install; `2.2.0` packed isolated-prefix install |
| Cold launch and prompt | PASS | Installed shell bootstrap under 500 ms, banner/session/prompt visible |
| Help/version/invalid command | PASS | Real subprocess tests; unknown command exits 2 locally without compatibility runtime |
| Graceful exit and Ctrl+C | PASS | `/exit` plus installed active-provider abort; task/plan cancelled and request closed |
| Complete slash-command inventory | PASS | Every list/guidance/parser path executed in isolated real shell subprocess |
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
| Scheduler/cron | PASS | Recurrence, one-shot, manual/due, scripts, timeout/output cap, stale-lock recovery |
| Memory | PASS | Persistence, search/ranking, consolidation/reset, browser workflow |
| Gateway framework/webhook | PASS | Auth, parsing, enable/disable, inbound, outbound, timeout/redaction, browser workflow |
| External Slack/Teams/Discord/Telegram | EXTERNAL | Connectors implemented; live channel credentials are not present locally |
| Dashboard | PASS | All 18 panels/actions manually exercised desktop/mobile; no console errors |
| HTTP auth/RBAC/input validation | PASS | Viewer/operator/admin tests, safe bind, signed inbound, malformed execution 400s |
| Browser security headers | PASS | CSP, frame denial, MIME sniffing, and referrer policy integration test |
| Secret handling/support bundle | PASS | Recursive sentinel scan across config/tasks/memory/logs; private output files |
| Dependency security | PASS | `npm audit`: zero vulnerabilities |
| Windows current branch | PASS | Local build, 181 tests, packed install/smoke |
| Ubuntu current branch | EXTERNAL | Required pull-request CI gate |
| Docker current branch | EXTERNAL | Docker absent locally; required pull-request CI gate |
| Documentation install path | PASS | Commands and `2.2.0` examples align with the final packed artifact |
| npm/GitHub provenance | PASS | Public `2.1.12` proof; workflow enforces provenance for subsequent tags |
| `2.2.0` public publication proof | EXTERNAL | Requires merge/tag authorization, npm publish, and GitHub release assets |
