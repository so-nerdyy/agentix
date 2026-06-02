"""
Agentix backend adapter for the Hermes frontend.
"""

import json
import os
import subprocess
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, Optional

BRIDGE_PORT = int(os.environ.get("AGENTIX_BRIDGE_PORT", "3456"))
BRIDGE_URL = f"http://127.0.0.1:{BRIDGE_PORT}"
_bridge_lock = threading.Lock()


def _get_bridge_url() -> str:
    return (
        os.environ.get("AGENTIX_BRIDGE_URL")
        or os.environ.get("HERMES_BRIDGE_URL")
        or BRIDGE_URL
    )


def _bridge_healthcheck() -> bool:
    try:
        req = urllib.request.Request(f"{_get_bridge_url()}/health")
        with urllib.request.urlopen(req, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def ensure_bridge_running() -> None:
    with _bridge_lock:
        if _bridge_healthcheck():
            return

        project_root = Path(__file__).resolve().parents[1]
        bridge_entry = project_root / "dist" / "bridge" / "entry.js"
        if not bridge_entry.exists():
            raise RuntimeError(
                f"Bridge entry not found at {bridge_entry}. Run `npm run build` first."
            )

        subprocess.Popen(
            ["node", str(bridge_entry)],
            cwd=str(project_root),
            env={
                **os.environ,
                "AGENTIX_BRIDGE_PORT": str(BRIDGE_PORT),
                "AGENTIX_BRIDGE_URL": _get_bridge_url(),
            },
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

        for _ in range(60):
            time.sleep(0.1)
            if _bridge_healthcheck():
                return

        raise RuntimeError("Agentix bridge failed to start within 6 seconds.")


class AgentixBackend:
    def __init__(
        self,
        model: Optional[str] = None,
        session_id: Optional[str] = None,
        **_: Any,
    ):
        self.model = model or os.environ.get("AGENTIX_MODEL")
        self.session_id = session_id or f"session-{os.getpid()}"
        ensure_bridge_running()

    def _post(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{_get_bridge_url()}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _get(self, path: str) -> Any:
        req = urllib.request.Request(f"{_get_bridge_url()}{path}")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def execute(
        self,
        stimulus: str,
        session_id: Optional[str] = None,
        stream_callback: Optional[Callable[[str], None]] = None,
        **_: Any,
    ) -> str:
        body: Dict[str, Any] = {"stimulus": stimulus}
        if session_id:
            body["sessionId"] = session_id
        if self.model:
            body["model"] = self.model

        req = urllib.request.Request(
            f"{_get_bridge_url()}/execute/stream",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        response = ""
        with urllib.request.urlopen(req, timeout=120) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8").strip()
                if not line.startswith("data: "):
                    continue
                payload = line[6:].replace("\\n", "\n")
                if payload == "[DONE]":
                    break
                try:
                    parsed = json.loads(payload)
                    if parsed.get("error"):
                        raise RuntimeError(parsed["error"])
                    delta = parsed.get("delta")
                    if delta:
                        if stream_callback:
                            stream_callback(delta)
                        response += delta
                except json.JSONDecodeError:
                    if stream_callback:
                        stream_callback(payload)
                    response += payload

        return response

    def get_sessions(self) -> Any:
        return self._get("/sessions")

    def create_session(self, model: Optional[str] = None) -> Any:
        body: Dict[str, Any] = {}
        if model:
            body["model"] = model
        return self._post("/sessions", body)

    def delete_session(self, session_id: str) -> None:
        req = urllib.request.Request(
            f"{_get_bridge_url()}/sessions/{session_id}",
            method="DELETE",
        )
        with urllib.request.urlopen(req, timeout=10):
            return None

    def memory_search(self, query: str) -> Any:
        from urllib.parse import quote

        return self._get(f"/memory/search?q={quote(query)}")

    def consolidate_memory(self, session_id: Optional[str] = None) -> Any:
        return self._post("/memory/consolidate", {"sessionId": session_id})

    def list_tools(self) -> Any:
        return self._get("/tools")

    def list_tasks(self, session_id: Optional[str] = None) -> Any:
        from urllib.parse import quote

        suffix = f"?sessionId={quote(session_id)}" if session_id else ""
        return self._get(f"/tasks{suffix}")

    def list_approvals(self) -> Any:
        return self._get("/approvals")

    def approve(self, task_id: str) -> Any:
        return self._post(f"/approvals/{task_id}/approve", {})

    def reject(self, task_id: str, reason: Optional[str] = None) -> Any:
        return self._post(f"/approvals/{task_id}/reject", {"reason": reason})

    def list_audit(self) -> Any:
        return self._get("/audit")

    def healing_stats(self) -> Any:
        return self._get("/healing/stats")

    def promote_healing_procedure(self, procedure_id: str) -> Any:
        return self._post(f"/healing/procedures/{procedure_id}/promote", {})

    def deprecate_healing_procedure(self, procedure_id: str) -> Any:
        return self._post(f"/healing/procedures/{procedure_id}/deprecate", {})

    def list_scheduled_jobs(self) -> Any:
        return self._get("/scheduler/jobs")

    def create_scheduled_job(
        self,
        name: str,
        stimulus: str,
        interval_ms: int,
        enabled: bool = True,
    ) -> Any:
        return self._post(
            "/scheduler/jobs",
            {
                "name": name,
                "stimulus": stimulus,
                "intervalMs": interval_ms,
                "enabled": enabled,
            },
        )

    def run_scheduled_job(self, job_id: str) -> Any:
        return self._post(f"/scheduler/jobs/{job_id}/run", {})
