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
