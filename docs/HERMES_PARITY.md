# Hermes Agent Parity Audit

Updated: 2026-07-12

## Audit Baseline

- Upstream: `NousResearch/hermes-agent`
- Upstream commit: `aaf5691261f12601db845386d650dce1cdfa30f9`
- Upstream version: `0.18.2`
- Vendored frontend baseline: `0.15.1` plus Agentix-specific integration work
- Product boundary: Hermes-derived code may render UI and integrations. Powerhouse,
  Symphony, and Pi must remain the only execution and durable-state architecture.

Statuses are evidence-based: `PASS`, `PARTIAL`, `GAP`, `EXTERNAL`, or `N/A`.

## Capability Matrix

| Surface | Status | Current evidence | Required closure |
| --- | --- | --- | --- |
| Full-screen Ink TUI | PARTIAL | Self-contained 2.9 MB Agentix bundle builds; 85 TUI files and 896 tests pass; installed `agentix --tui` launches | Finish real PTY proof and CI on Windows, Ubuntu, and macOS |
| TUI static analysis | GAP | Type-check passes, but full lint reports 38 errors and 102 warnings in the vendored baseline | Fix errors and actionable warnings, then make lint a CI gate |
| Plain `agentix` launch | PARTIAL | Interactive TTY now selects the full TUI; piped input retains the deterministic backend shell | Prove real PTY startup and interaction from the packed install on all platforms |
| Agentix branding | PARTIAL | TUI process, skin, version, update command, hero, and launcher are Agentix-branded | Complete repository/runtime scan and remove remaining user-visible Hermes/Nous paths |
| Prompt execution ownership | PASS | `_AgentixTuiProxy` delegates conversation work to `/execute/stream`; no Hermes `AIAgent` is constructed in Agentix mode | Keep invariant covered by installed smoke |
| TUI cancellation | PARTIAL | Adapter regression and packed fixture prove bounded interruption and provider abort | Prove the real TUI keypress path in a PTY and complete platform CI |
| TUI sessions/history | GAP | TUI `session.list`, `session.resume`, deletion, titles, and history still use Hermes `SessionDB` | Route every TUI session operation through Powerhouse session APIs |
| TUI slash-command ownership | GAP | Unknown TUI commands still reach the persistent Hermes `_SlashWorker` | Add Agentix RPC dispatch and prohibit commands that mutate Hermes runtime state |
| Setup wizard | PASS | Workspace provider/model/key/base URL and Luna/Terra setup are Agentix-owned and secret-safe | Keep clean-install coverage current |
| Provider/model selection | PASS | Kilo, OpenAI-compatible, Anthropic, and local config plus catalog search/list and live verification exist | Re-run live providers when credentials are available |
| Core slash inventory | GAP | Vendored registry has 70 commands versus upstream's 82 | Implement compatible missing commands: `blueprint`, `hatch`, `journey`, `learn`, `memory`, `moa`, `pet`, `prompt`, `suggestions`, `timestamps`, `version`; treat `billing`/`credits` as N/A unless Agentix gains a billing service; remove obsolete `gquota` |
| Cron/scheduler | PARTIAL | Powerhouse scheduler and Agentix CLI/compatibility cron adapter are tested | Route and test TUI `/cron` exclusively through Agentix |
| Tools | PARTIAL | Backend tool inventory is exposed to the TUI | Preserve real schemas, enable/disable operations, approvals, and execution through Pi |
| Skills | GAP | Hermes skills are hidden in Agentix TUI metadata to avoid false ownership | Implement Agentix skill discovery/install/enable/reset and Pi prompt/tool integration |
| Plugins | GAP | Public plugin commands are primarily compatibility-frontend workflows | Define safe Agentix plugin lifecycle, signatures/permissions, rollback, and backend registration |
| MCP | GAP | Hermes MCP metadata is intentionally suppressed in Agentix mode | Add an Agentix-owned MCP lifecycle or explicitly remove the advertised feature |
| Memory/self-learning | PARTIAL | Powerhouse memory, healing, promotion, deprecation, and rollback exist | Expose complete TUI workflows and prove bounded approval-aware evolution end to end |
| Named gateways | PASS | Slack, Discord, Telegram, Teams, and webhook adapters/configuration exist | Live delivery remains credential-dependent |
| Extended Hermes gateways | PARTIAL | Current upstream contains 20 platform plugins; Agentix supports the five release-goal platforms | Decide and document supported parity scope; port compatible platforms only through Agentix gateway contracts |
| Dashboard/API | PASS | Agentix dashboard, RBAC API, OpenAPI, streaming, task controls, and browser workflows are tested | Re-run final installed smoke/CI |
| Updates | PASS | Agentix npm update check/install flow and release workflow exist | Public 2.2.0 verification requires publish authorization |
| Diagnostics/logs/support | PASS | Doctor, readiness, logs, usage, support bundle, redaction, and integrity checks exist | Keep installed-product proof current |
| npm/source installers | PASS | Isolated npm pack/install, bundled TUI, checksum, source flow, shell and PowerShell installers pass locally | Keep final platform CI green |
| Docker | PARTIAL | Existing image/compose validation passed on the prior commit | Re-run CI on the final commit with the packaged TUI |
| macOS | GAP | macOS was absent from the prior matrix; workflow now includes it | Obtain green macOS build, TUI tests, release smoke, and installer dry run |
| OpenClaw migration | GAP | No current installed-product proof demonstrates a safe migration workflow | Implement/import with preview, backup, secret safety, and rollback or stop advertising it |
| Terminal backends | GAP | Hermes offers local/container/SSH-style environments beyond current Agentix Pi profiles | Define supported Agentix execution backends and enforce Powerhouse approvals/sandboxing |
| Commercial Nous commands | N/A | `billing` and `credits` target Nous services, not a generic agent capability | Do not copy service-specific commands without an Agentix service contract |

## Command Delta

Current upstream commands missing from the vendored registry:

`billing`, `blueprint`, `credits`, `hatch`, `journey`, `learn`, `memory`, `moa`,
`pet`, `prompt`, `suggestions`, `timestamps`, `version`.

The vendored-only `gquota` command is obsolete relative to current upstream and must
not remain as an unexplained compatibility artifact.

## Architecture Gate

Parity is not achieved by copying every upstream file. A feature passes only when its
user-facing behavior is available and all state mutation, orchestration, execution,
approval, cancellation, persistence, recovery, and healing flow through Agentix.
Hermes `AIAgent`, `SessionDB`, cron, memory, or tool execution may not become a hidden
second backend.
