"""Hermes CLI command adapters backed by the Agentix bridge.

These adapters are active only when the Hermes frontend is launched by Agentix
(`AGENTIX_FRONTEND=hermes`). Upstream Hermes commands keep their native behavior
when run standalone.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Iterable


def using_agentix_backend() -> bool:
    return (
        os.environ.get("AGENTIX_FRONTEND") == "hermes"
        and os.environ.get("AGENTIX_DISABLE_BACKEND_COMMANDS") != "1"
    )


def _backend() -> Any:
    from agentix_backend import AgentixBackend

    return AgentixBackend()


def _clip(value: Any, limit: int = 80) -> str:
    text = str(value or "")
    return text if len(text) <= limit else text[: limit - 3] + "..."


def _dump(value: Any) -> None:
    print(json.dumps(value, indent=2, ensure_ascii=False))


def _iter_entries(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                yield item


def _workspace_dir() -> Path:
    return Path(os.environ.get("AGENTIX_WORKSPACE_DIR") or os.getcwd()).resolve()


def _data_dir() -> Path:
    return Path(os.environ.get("AGENTIX_DATA_DIR") or (_workspace_dir() / "data")).resolve()


def _provider_key_candidates(provider: str) -> list[str]:
    normalized = (provider or "").lower()
    if "anthropic" in normalized or "claude" in normalized:
        return ["ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN"]
    if "openrouter" in normalized:
        return ["OPENROUTER_API_KEY", "OPENAI_API_KEY"]
    if "gemini" in normalized or "google" in normalized:
        return ["GEMINI_API_KEY", "GOOGLE_API_KEY"]
    if "deepseek" in normalized:
        return ["DEEPSEEK_API_KEY", "OPENAI_API_KEY"]
    if "groq" in normalized:
        return ["GROQ_API_KEY", "OPENAI_API_KEY"]
    if "mistral" in normalized:
        return ["MISTRAL_API_KEY", "OPENAI_API_KEY"]
    if "xai" in normalized or "grok" in normalized:
        return ["XAI_API_KEY", "OPENAI_API_KEY"]
    return ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"]


def sync_agentix_runtime_config() -> dict[str, Any]:
    """Mirror Hermes provider/model selection into Agentix runtime config.

    Secrets stay in Hermes' .env; Agentix stores only non-secret defaults in
    workspace data/config.json and reads the API key from the process env when
    the backend starts.
    """
    from hermes_cli.config import get_env_value, load_config

    cfg = load_config()
    model_cfg = cfg.get("model") if isinstance(cfg, dict) else {}
    if not isinstance(model_cfg, dict):
        model_cfg = {"default": model_cfg} if model_cfg else {}

    model = str(model_cfg.get("default") or "").strip()
    provider = str(model_cfg.get("provider") or "auto").strip() or "auto"
    base_url = str(model_cfg.get("base_url") or "").strip()

    key = ""
    for key_name in _provider_key_candidates(provider):
        key = get_env_value(key_name) or os.environ.get(key_name, "")
        if key:
            break

    if model:
        os.environ["AGENTIX_MODEL"] = model
    if provider:
        os.environ["AGENTIX_PROVIDER"] = provider
    if base_url:
        os.environ["AGENTIX_BASE_URL"] = base_url
    if key:
        os.environ["AGENTIX_LLM_API_KEY"] = key

    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    config_path = data_dir / "config.json"
    existing: dict[str, Any] = {}
    if config_path.exists():
        try:
            loaded = json.loads(config_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                existing = loaded
        except Exception:
            existing = {}

    updated = dict(existing)
    if model:
        updated["model"] = model
    if provider:
        updated["provider"] = provider
    if base_url:
        updated["baseUrl"] = base_url
    config_path.write_text(json.dumps(updated, indent=2) + "\n", encoding="utf-8")

    return {
        "model": model or None,
        "provider": provider or None,
        "baseUrl": base_url or None,
        "apiKeyConfigured": bool(key),
        "configPath": str(config_path),
    }


def handle_setup(args: Any) -> bool:
    if not using_agentix_backend():
        return False

    from hermes_cli.setup import run_setup_wizard

    run_setup_wizard(args)
    synced = sync_agentix_runtime_config()
    print(f"Agentix backend config synced: {synced['configPath']}")
    return True


def handle_model(args: Any) -> bool:
    if not using_agentix_backend():
        return False

    from hermes_cli.main import _require_tty, select_provider_and_model

    _require_tty("model")
    if getattr(args, "refresh", False):
        try:
            from hermes_cli.models import clear_provider_models_cache
            clear_provider_models_cache()
            print("  Cleared model picker cache.")
        except Exception:
            pass
    select_provider_and_model(args=args)
    synced = sync_agentix_runtime_config()
    print(f"Agentix backend config synced: {synced['configPath']}")
    return True


def handle_oneshot(
    prompt: str,
    model: str | None = None,
    provider: str | None = None,
    toolsets: object = None,
) -> int | None:
    if not using_agentix_backend():
        return None

    backend = _backend()
    session = backend.create_session(model=model)
    response = backend.execute(str(prompt), session_id=session.get("id"))
    if response:
        print(response)
    return 0


def handle_chat(args: Any) -> bool:
    if not using_agentix_backend():
        return False
    if getattr(args, "tui", False) or os.environ.get("HERMES_TUI") == "1":
        return False

    backend = _backend()
    session_id = getattr(args, "resume", None)
    if not session_id:
        session = backend.create_session(model=getattr(args, "model", None))
        session_id = session.get("id")

    query = getattr(args, "query", None)
    if query:
        _stream_agentix_response(backend, str(query), session_id)
        return True

    print("Agentix Hermes frontend - backend: Powerhouse/Symphony/Pi")
    print("Type a message, /help, or /exit.\n")
    while True:
        try:
            line = input("agentix> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return True
        if not line:
            continue
        lowered = line.lower()
        if lowered in {"/exit", "/quit", "exit", "quit"}:
            return True
        if lowered == "/help":
            print("Commands: /help, /sessions, /tools, /memory <query>, /exit")
            continue
        if lowered == "/sessions":
            _print_sessions(list(_iter_entries(backend.list_sessions())), 20)
            continue
        if lowered == "/plans":
            _print_plans(list(_iter_entries(backend.list_plans())))
            continue
        if lowered.startswith("/plan"):
            plan_id = line[len("/plan"):].strip()
            if not plan_id:
                print("Usage: /plan <plan-id>")
                continue
            _print_plan_detail(backend.get_plan(plan_id))
            continue
        if lowered == "/tools":
            _print_tools(backend.list_tools())
            continue
        if lowered.startswith("/memory"):
            query_text = line[len("/memory"):].strip()
            if not query_text:
                print("Usage: /memory <query>")
                continue
            _print_memory_results(query_text, backend.memory_search(query_text))
            continue
        _stream_agentix_response(backend, line, session_id)
    return True


def _stream_agentix_response(backend: Any, prompt: str, session_id: str | None) -> None:
    def write_delta(delta: str) -> None:
        sys.stdout.write(delta)
        sys.stdout.flush()

    response = backend.execute(prompt, session_id=session_id, stream_callback=write_delta)
    if not response.endswith("\n"):
        print()


def _print_tools(value: Any) -> None:
    tools = list(_iter_entries(value))
    if not tools:
        print("No Agentix Pi tools registered.")
        return
    print("Agentix backend tools")
    print(f"{'Name':<22} Description")
    print("-" * 80)
    for tool in tools:
        name = tool.get("name") or tool.get("id") or "unknown"
        print(f"{_clip(name, 22):<22} {_clip(tool.get('description'), 120)}")


def _print_memory_results(query: str, value: Any) -> None:
    results = list(_iter_entries(value))
    if not results:
        print("No Agentix memory results.")
        return
    print(f"Agentix memory search: {query}")
    for item in results:
        score = item.get("score", 0)
        print(f"  [{score}] {_clip(item.get('content'), 160)}")


def _print_sessions(sessions: list[dict[str, Any]], limit: int) -> None:
    visible = sessions[:limit]
    if not visible:
        print("No Agentix sessions found.")
        return
    print(f"{'ID':<18} {'Created':<26} {'Status':<10} Metadata")
    print("-" * 88)
    for session in visible:
        metadata = session.get("metadata") if isinstance(session.get("metadata"), dict) else {}
        status = session.get("status", "active")
        print(
            f"{_clip(session.get('id'), 18):<18} "
            f"{_clip(session.get('createdAt'), 26):<26} "
            f"{_clip(status, 10):<10} "
            f"{_clip(json.dumps(metadata, ensure_ascii=False), 32)}"
        )


def _print_plans(plans: list[dict[str, Any]]) -> None:
    if not plans:
        print("No Agentix Symphony plans recorded.")
        return
    print(f"{'ID':<18} {'Status':<16} {'Planner':<10} {'Steps':<6} {'Tasks':<6} Stimulus")
    print("-" * 96)
    for plan in plans[:20]:
        print(
            f"{_clip(plan.get('id'), 18):<18} "
            f"{_clip(plan.get('status'), 16):<16} "
            f"{_clip(plan.get('planner'), 10):<10} "
            f"{str(plan.get('stepCount', 0)):<6} "
            f"{str(plan.get('taskCount', 0)):<6} "
            f"{_clip(plan.get('stimulus'), 80)}"
        )


def _print_plan_detail(detail: dict[str, Any]) -> None:
    plan = detail.get("plan") if isinstance(detail.get("plan"), dict) else {}
    steps = list(_iter_entries(detail.get("steps")))
    tasks = list(_iter_entries(detail.get("tasks")))
    audit = list(_iter_entries(detail.get("audit")))
    print(f"Plan {plan.get('id', '')} [{plan.get('status', '')}]")
    print(f"  Planner: {plan.get('planner', '')}")
    print(f"  Stimulus: {_clip(plan.get('stimulus'), 180)}")
    if plan.get("reasoning"):
        print(f"  Reasoning: {plan.get('reasoning')}")
    if plan.get("fallbackReason"):
        print(f"  Fallback: {plan.get('fallbackReason')}")
    print(f"  Steps ({len(steps)})")
    for step in steps:
        depends = ",".join(step.get("dependsOn") or []) or "none"
        print(
            f"    - {step.get('id', '')} [{step.get('status', 'pending')}] "
            f"{step.get('kind', '')} depends={depends} task={step.get('taskId', '-')}"
        )
    print(f"  Tasks ({len(tasks)})")
    for task in tasks[:8]:
        print(f"    - {task.get('id', '')} [{task.get('status', '')}] {task.get('kind', '')}")
    print(f"  Audit ({len(audit)})")
    for entry in audit[:5]:
        print(f"    - {entry.get('type', '')} {entry.get('id', '')}")


def handle_sessions(args: Any, sessions_parser: Any = None) -> bool:
    if not using_agentix_backend():
        return False

    backend = _backend()
    action = getattr(args, "sessions_action", None) or "list"

    if action == "list":
        sessions = list(_iter_entries(backend.list_sessions()))
        _print_sessions(sessions, int(getattr(args, "limit", 20) or 20))
        return True

    if action == "delete":
        session_id = getattr(args, "session_id", "")
        if not getattr(args, "yes", False):
            try:
                answer = input(f"Delete Agentix session '{session_id}'? [y/N] ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                answer = ""
            if answer not in {"y", "yes"}:
                print("Cancelled.")
                return True
        backend.delete_session(session_id)
        print(f"Deleted Agentix session '{session_id}'.")
        return True

    if action == "export":
        output = getattr(args, "output", "-")
        session_id = getattr(args, "session_id", None)
        records: list[Any]
        if session_id:
            records = [backend.get_session(session_id)]
        else:
            records = list(_iter_entries(backend.list_sessions()))
        lines = [json.dumps(record, ensure_ascii=False) for record in records]
        if output == "-":
            for line in lines:
                print(line)
        else:
            with open(output, "w", encoding="utf-8") as handle:
                handle.write("\n".join(lines) + ("\n" if lines else ""))
            print(f"Exported {len(lines)} Agentix session(s) to {output}")
        return True

    if action == "stats":
        sessions = list(_iter_entries(backend.list_sessions()))
        tasks = list(_iter_entries(backend.list_tasks()))
        memory = list(_iter_entries(backend.list_memory()))
        approvals = list(_iter_entries(backend.list_approvals()))
        print("Agentix session store")
        print(f"  Sessions:  {len(sessions)}")
        print(f"  Tasks:     {len(tasks)}")
        print(f"  Memory:    {len(memory)}")
        print(f"  Approvals: {len(approvals)}")
        return True

    if action == "browse":
        sessions = list(_iter_entries(backend.list_sessions()))
        _print_sessions(sessions, int(getattr(args, "limit", 500) or 500))
        print("\nUse `agentix sessions list` and continue in the normal Agentix shell.")
        return True

    if action in {"rename", "prune", "optimize"}:
        print(f"Agentix backend does not support `sessions {action}` yet.")
        print("Use `agentix sessions list|stats|export|delete` for backend-owned sessions.")
        return True

    if sessions_parser is not None:
        sessions_parser.print_help()
    return True


def handle_logs(args: Any) -> bool:
    if not using_agentix_backend():
        return False

    backend = _backend()
    log_name = getattr(args, "log_name", "agent") or "agent"
    limit = int(getattr(args, "lines", 50) or 50)

    if log_name == "list":
        print("Agentix backend logs")
        print("  runtime     Bridge/runtime events from data/logs/runtime.jsonl")
        return True

    min_level = (getattr(args, "level", None) or "").lower()
    session_filter = getattr(args, "session", None)
    component = getattr(args, "component", None)

    def filtered() -> list[dict[str, Any]]:
        entries = list(_iter_entries(backend.list_logs(limit=max(limit, 100))))
        result = []
        for entry in entries:
            level = str(entry.get("level", "")).lower()
            message = str(entry.get("message", ""))
            source = str(entry.get("source", ""))
            if min_level and level != min_level:
                continue
            if session_filter and session_filter not in message:
                continue
            if component and component not in source and component not in message:
                continue
            result.append(entry)
        return result[:limit]

    seen: set[str] = set()

    def print_entries(entries: list[dict[str, Any]]) -> None:
        for entry in reversed(entries):
            key = json.dumps(entry, sort_keys=True, ensure_ascii=False)
            if key in seen:
                continue
            seen.add(key)
            print(
                f"{entry.get('timestamp', '')} "
                f"{str(entry.get('level', '')).upper():<5} "
                f"{entry.get('source', 'runtime')}: {entry.get('message', '')}"
            )

    print("--- Agentix backend runtime logs ---")
    print_entries(filtered())

    if getattr(args, "follow", False):
        try:
            while True:
                time.sleep(0.5)
                print_entries(filtered())
                sys.stdout.flush()
        except KeyboardInterrupt:
            print("\n--- stopped ---")

    return True


def handle_tools(args: Any) -> bool:
    if not using_agentix_backend():
        return False

    action = getattr(args, "tools_action", None)
    if action not in {None, "list"} and not getattr(args, "summary", False):
        print("Agentix backend tools are Pi agents registered by the Powerhouse.")
        print("Per-platform Hermes tool toggles do not apply to backend-owned Pi agents.")
        print("Use `agentix tools list` to inspect available Pi agents.")
        return True

    tools = list(_iter_entries(_backend().list_tools()))
    if not tools:
        print("No Agentix Pi tools registered.")
        return True
    print("Agentix backend tools")
    print(f"{'Name':<22} Description")
    print("-" * 80)
    for tool in tools:
        name = tool.get("name") or tool.get("id") or "unknown"
        print(f"{_clip(name, 22):<22} {_clip(tool.get('description'), 120)}")
    return True


def handle_memory(args: Any) -> bool:
    if not using_agentix_backend():
        return False

    backend = _backend()
    sub = getattr(args, "memory_command", None) or "status"

    if sub == "status":
        records = list(_iter_entries(backend.list_memory()))
        by_role: dict[str, int] = {}
        for record in records:
            role = str(record.get("role", "unknown"))
            by_role[role] = by_role.get(role, 0) + 1
        print("Agentix memory backend")
        print(f"  Records: {len(records)}")
        for role, count in sorted(by_role.items()):
            print(f"  {role}: {count}")
        return True

    if sub == "search":
        query = " ".join(getattr(args, "query", []) or []).strip()
        if not query:
            print("Usage: agentix memory search <query>")
            return True
        results = backend.memory_search(query)
        if not results:
            print("No Agentix memory results.")
            return True
        print(f"Agentix memory search: {query}")
        for item in _iter_entries(results):
            score = item.get("score", 0)
            print(f"  [{score}] {_clip(item.get('content'), 160)}")
        return True

    if sub == "consolidate":
        session_id = getattr(args, "session_id", None)
        _dump(backend.consolidate_memory(session_id))
        return True

    return False


def _format_job_time(value: Any) -> str:
    if not value:
        return "-"
    try:
        return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(float(value) / 1000))
    except Exception:
        return str(value)


def _print_jobs(jobs: list[dict[str, Any]], include_disabled: bool = False) -> None:
    visible = [job for job in jobs if include_disabled or job.get("enabled", True)]
    if not visible:
        print("No Agentix scheduled jobs.")
        return
    print(f"{'ID':<14} {'Enabled':<7} {'Schedule':<18} {'Next run':<19} Name")
    print("-" * 88)
    for job in visible:
        print(
            f"{_clip(job.get('id'), 14):<14} "
            f"{str(bool(job.get('enabled', True))).lower():<7} "
            f"{_clip(job.get('scheduleDisplay') or job.get('schedule'), 18):<18} "
            f"{_format_job_time(job.get('nextRunAt')):<19} "
            f"{_clip(job.get('name'), 80)}"
        )


def _cron_create_body(args: Any) -> dict[str, Any]:
    stimulus = getattr(args, "prompt", None) or ""
    script = getattr(args, "script", None)
    no_agent = bool(getattr(args, "no_agent", False))
    if not stimulus and script:
        stimulus = f"Run scheduled script {script}"
    name = getattr(args, "name", None) or (stimulus[:48] if stimulus else script) or "scheduled task"
    body: dict[str, Any] = {
        "name": name,
        "stimulus": stimulus,
        "schedule": getattr(args, "schedule", None),
        "enabled": True,
    }
    if script:
        body["script"] = script
    if no_agent:
        body["noAgent"] = True
    if getattr(args, "workdir", None):
        body["workdir"] = getattr(args, "workdir")
    if getattr(args, "skills", None):
        body["skills"] = getattr(args, "skills")
    return body


def handle_cron(args: Any) -> bool:
    if not using_agentix_backend():
        return False

    backend = _backend()
    command = getattr(args, "cron_command", None) or "list"

    if command == "list":
        jobs = list(_iter_entries(backend.list_scheduled_jobs()))
        _print_jobs(jobs, include_disabled=bool(getattr(args, "all", False)))
        return True

    if command in {"create", "add"}:
        body = _cron_create_body(args)
        job = backend.create_scheduled_job(
            name=str(body["name"]),
            stimulus=str(body["stimulus"]),
            schedule=body.get("schedule"),
            script=body.get("script"),
            no_agent=body.get("noAgent"),
            workdir=body.get("workdir"),
            skills=body.get("skills"),
            enabled=True,
        )
        print(f"Created Agentix scheduled job: {job.get('id')} ({job.get('scheduleDisplay')})")
        return True

    if command == "edit":
        job_id = getattr(args, "job_id", "")
        patch: dict[str, Any] = {}
        if getattr(args, "name", None) is not None:
            patch["name"] = getattr(args, "name")
        if getattr(args, "prompt", None) is not None:
            patch["stimulus"] = getattr(args, "prompt")
        if getattr(args, "schedule", None) is not None:
            patch["schedule"] = getattr(args, "schedule")
        if getattr(args, "script", None) is not None:
            script = getattr(args, "script")
            patch["script"] = script or None
        if getattr(args, "no_agent", None) is not None:
            patch["no_agent"] = getattr(args, "no_agent")
        if getattr(args, "workdir", None) is not None:
            workdir = getattr(args, "workdir")
            patch["workdir"] = workdir or None
        skills = getattr(args, "skills", None)
        add_skills = getattr(args, "add_skills", None)
        remove_skills = getattr(args, "remove_skills", None)
        if getattr(args, "clear_skills", False):
            patch["skills"] = []
        elif skills is not None:
            patch["skills"] = skills
        elif add_skills or remove_skills:
            current = backend.get_scheduled_job(job_id)
            current_skills = list(current.get("skills") or [])
            for skill in add_skills or []:
                if skill not in current_skills:
                    current_skills.append(skill)
            for skill in remove_skills or []:
                current_skills = [item for item in current_skills if item != skill]
            patch["skills"] = current_skills
        updated = backend.update_scheduled_job(job_id, **patch)
        if updated.get("ok") is False or not updated.get("job"):
            print(f"Agentix scheduled job not found: {job_id}")
        else:
            job = updated.get("job", {})
            print(f"Updated Agentix scheduled job: {job.get('id')}")
        return True

    if command == "pause":
        job_id = getattr(args, "job_id", "")
        job = backend.set_scheduled_job_enabled(job_id, False)
        print(f"Paused Agentix scheduled job: {job.get('id', job_id)}")
        return True

    if command == "resume":
        job_id = getattr(args, "job_id", "")
        job = backend.set_scheduled_job_enabled(job_id, True)
        print(f"Resumed Agentix scheduled job: {job.get('id', job_id)}")
        return True

    if command == "run":
        result = backend.run_scheduled_job(getattr(args, "job_id", ""))
        if result.get("ok"):
            print("Agentix scheduled job ran successfully.")
        else:
            print(f"Agentix scheduled job failed: {result.get('error')}")
        return True

    if command in {"remove", "rm", "delete"}:
        result = backend.delete_scheduled_job(getattr(args, "job_id", ""))
        print("Removed Agentix scheduled job." if result.get("ok") else "Agentix scheduled job was not found.")
        return True

    if command == "status":
        jobs = list(_iter_entries(backend.list_scheduled_jobs()))
        enabled = len([job for job in jobs if job.get("enabled", True)])
        print("Agentix scheduler")
        print(f"  Jobs:    {len(jobs)}")
        print(f"  Enabled: {enabled}")
        print("  Runtime: backend scheduler runs inside `agentix server` or the bridge process")
        return True

    if command == "tick":
        result = backend.run_due_scheduled_jobs()
        print(f"Ran {result.get('count', 0)} due Agentix scheduled job(s).")
        return True

    return False
