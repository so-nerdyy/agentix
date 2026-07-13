"""
Agentix backend adapter for the Hermes frontend.
"""

import json
import os
import socket
import subprocess
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, Optional
from urllib.parse import quote

BRIDGE_PORT = int(os.environ.get("AGENTIX_BRIDGE_PORT", "3456"))
BRIDGE_URL = f"http://127.0.0.1:{BRIDGE_PORT}"
_bridge_lock = threading.Lock()


def _get_bridge_url() -> str:
    return (
        os.environ.get("AGENTIX_BRIDGE_URL")
        or os.environ.get("HERMES_BRIDGE_URL")
        or BRIDGE_URL
    )


def _auth_headers() -> Dict[str, str]:
    token = os.environ.get("AGENTIX_SESSION_TOKEN")
    return {"Authorization": f"Bearer {token}"} if token else {}


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

        workspace_root = Path(os.environ.get("AGENTIX_WORKSPACE_DIR") or os.getcwd()).resolve()

        subprocess.Popen(
            ["node", str(bridge_entry)],
            cwd=str(workspace_root),
            env={
                **os.environ,
                "AGENTIX_INSTALL_ROOT": str(project_root),
                "AGENTIX_WORKSPACE_DIR": str(workspace_root),
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
        self.session_id = session_id
        self._interrupt_event = threading.Event()
        self._response_lock = threading.Lock()
        self._active_response: Any = None
        self.was_interrupted = False
        ensure_bridge_running()

    def interrupt(self) -> None:
        self.was_interrupted = True
        self._interrupt_event.set()
        with self._response_lock:
            response = self._active_response
        if response is not None:
            # HTTPResponse.close() can block behind a reader holding the
            # buffered stream lock. The Agentix bridge sends bounded SSE
            # heartbeats so execute() observes the interrupt itself; this
            # socket shutdown is an additional best-effort wake-up for other
            # compatible endpoints and never blocks the interrupt caller.
            stream = getattr(response, "fp", None)
            raw = getattr(stream, "raw", None)
            transports = (
                getattr(raw, "_sock", None),
                getattr(stream, "_sock", None),
                raw,
                stream,
            )
            for transport in transports:
                shutdown = getattr(transport, "shutdown", None)
                if not callable(shutdown):
                    continue
                try:
                    shutdown(socket.SHUT_RDWR)
                    return
                except Exception:
                    continue

            # Unknown response implementations still get a best-effort close,
            # but never block the UI's interrupt handler on that close.
            threading.Thread(target=self._close_response, args=(response,), daemon=True).start()

    @staticmethod
    def _close_response(response: Any) -> None:
        try:
            response.close()
        except Exception:
            pass

    def _post(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{_get_bridge_url()}{path}",
            data=data,
            headers={"Content-Type": "application/json", **_auth_headers()},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _get(self, path: str, timeout: int = 10) -> Any:
        req = urllib.request.Request(f"{_get_bridge_url()}{path}", headers=_auth_headers())
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _delete(self, path: str) -> Any:
        req = urllib.request.Request(f"{_get_bridge_url()}{path}", method="DELETE", headers=_auth_headers())
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None

    def execute(
        self,
        stimulus: str,
        session_id: Optional[str] = None,
        stream_callback: Optional[Callable[[str], None]] = None,
        model: Optional[str] = None,
        provider: Optional[str] = None,
        toolsets: Any = None,
        **extra: Any,
    ) -> str:
        body: Dict[str, Any] = {"stimulus": stimulus}
        if session_id:
            body["sessionId"] = session_id
        selected_model = model or self.model
        if selected_model:
            body["model"] = selected_model
        if provider:
            body["provider"] = provider
        if toolsets:
            body["toolsets"] = toolsets
        for key in ("baseUrl", "base_url"):
            if extra.get(key):
                body["baseUrl"] = extra[key]

        req = urllib.request.Request(
            f"{_get_bridge_url()}/execute/stream",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", **_auth_headers()},
            method="POST",
        )

        response = ""
        self.was_interrupted = False
        self._interrupt_event.clear()
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                with self._response_lock:
                    self._active_response = resp
                for raw_line in resp:
                    if self._interrupt_event.is_set():
                        break
                    line = raw_line.decode("utf-8").rstrip("\r\n")
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:]
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
                        payload = payload.replace("\\n", "\n")
                        if stream_callback:
                            stream_callback(payload)
                        response += payload
        except (OSError, ValueError):
            if not self._interrupt_event.is_set():
                raise
        finally:
            with self._response_lock:
                self._active_response = None
            self.was_interrupted = self._interrupt_event.is_set()

        return response

    def get_sessions(self) -> Any:
        return self._get("/sessions")

    def list_sessions(self) -> Any:
        return self.get_sessions()

    def doctor(self) -> Any:
        return self._get("/doctor", timeout=60)

    def usage(self) -> Any:
        return self._get("/usage", timeout=60)

    def config(self) -> Any:
        return self._get("/config")

    def auth_status(self) -> Any:
        return self._get("/auth/status")

    def list_auth_tokens(self) -> Any:
        return self._get("/auth/tokens")

    def create_auth_token(self, label: str | None = None, role: str | None = None) -> Any:
        return self._post("/auth/tokens", {"label": label, "role": role})

    def revoke_auth_token(self, token_id: str) -> Any:
        return self._delete(f"/auth/tokens/{quote(token_id)}")

    def set_config(self, key: str, value: Any) -> Any:
        return self._post("/config", {"key": key, "value": value})

    def get_session(self, session_id: str) -> Any:
        return self._get(f"/sessions/{quote(session_id)}")

    def create_session(
        self,
        model: Optional[str] = None,
        provider: Optional[str] = None,
        toolsets: Any = None,
    ) -> Any:
        body: Dict[str, Any] = {}
        if model:
            body["model"] = model
        if provider:
            body["provider"] = provider
        if toolsets:
            body["toolsets"] = toolsets
        return self._post("/sessions", body)

    def delete_session(self, session_id: str) -> None:
        self._delete(f"/sessions/{quote(session_id)}")
        return None

    def rename_session(self, session_id: str, title: str) -> Any:
        return self._post(f"/sessions/{quote(session_id)}/rename", {"title": title})

    def prune_sessions(self, older_than_days: Optional[int] = None, source: Optional[str] = None) -> Any:
        body: Dict[str, Any] = {}
        if older_than_days is not None:
            body["olderThanDays"] = older_than_days
        if source:
            body["source"] = source
        return self._post("/sessions/prune", body)

    def optimize_sessions(self) -> Any:
        return self._post("/sessions/optimize", {})

    def memory_search(self, query: str) -> Any:
        return self._get(f"/memory/search?q={quote(query)}")

    def list_memory(self, session_id: Optional[str] = None) -> Any:
        suffix = f"?sessionId={quote(session_id)}" if session_id else ""
        return self._get(f"/memory{suffix}")

    def consolidate_memory(self, session_id: Optional[str] = None) -> Any:
        return self._post("/memory/consolidate", {"sessionId": session_id})

    def reset_memory(
        self,
        target: str = "all",
        session_id: Optional[str] = None,
    ) -> Any:
        body: Dict[str, Any] = {"target": target}
        if session_id:
            body["sessionId"] = session_id
        return self._post("/memory/reset", body)

    def list_tools(self) -> Any:
        return self._get("/tools")

    def get_tool(self, tool_id: str) -> Any:
        return self._get(f"/tools/{quote(tool_id)}")

    def search(self, query: str) -> Any:
        return self._get(f"/search?q={quote(query)}")

    def list_plans(self) -> Any:
        return self._get("/plans")

    def get_plan(self, plan_id: str) -> Any:
        return self._get(f"/plans/{quote(plan_id)}")

    def control_plan(self, plan_id: str, action: str) -> Any:
        return self._post(f"/plans/{quote(plan_id)}/action", {"action": action})

    def list_logs(self, limit: int = 100) -> Any:
        return self._get(f"/logs?limit={int(limit)}")

    def get_log(self, index: int) -> Any:
        return self._get(f"/logs/{int(index)}")

    def list_tasks(self, session_id: Optional[str] = None) -> Any:
        suffix = f"?sessionId={quote(session_id)}" if session_id else ""
        return self._get(f"/tasks{suffix}")

    def get_task(self, task_id: str) -> Any:
        return self._get(f"/tasks/{quote(task_id)}")

    def control_task(self, task_id: str, action: str) -> Any:
        return self._post(f"/tasks/{quote(task_id)}/action", {"action": action})

    def list_approvals(self) -> Any:
        return self._get("/approvals")

    def get_approval(self, task_id: str) -> Any:
        return self._get(f"/approvals/{quote(task_id)}")

    def approve(self, task_id: str) -> Any:
        return self._post(f"/approvals/{quote(task_id)}/approve", {})

    def reject(self, task_id: str, reason: Optional[str] = None) -> Any:
        return self._post(f"/approvals/{quote(task_id)}/reject", {"reason": reason})

    def list_audit(self) -> Any:
        return self._get("/audit")

    def get_audit(self, audit_id: str) -> Any:
        return self._get(f"/audit/{quote(audit_id)}")

    def healing_stats(self) -> Any:
        return self._get("/healing/stats")

    def promote_healing_procedure(self, procedure_id: str) -> Any:
        return self._post(f"/healing/procedures/{quote(procedure_id)}/promote", {})

    def deprecate_healing_procedure(self, procedure_id: str) -> Any:
        return self._post(f"/healing/procedures/{quote(procedure_id)}/deprecate", {})

    def get_healing_detail(self, detail_id: str) -> Any:
        return self._get(f"/healing/detail/{quote(detail_id)}")

    def list_gateways(self) -> Any:
        return self._get("/gateway")

    def get_gateway(self, gateway_id: str) -> Any:
        return self._get(f"/gateway/{quote(gateway_id)}")

    def set_gateway_enabled(self, gateway_id: str, enabled: bool) -> Any:
        action = "enable" if enabled else "disable"
        return self._post(f"/gateway/{quote(gateway_id)}/{action}", {})

    def receive_gateway_message(
        self,
        gateway_id: str,
        stimulus: str,
        session_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Any:
        body: Dict[str, Any] = {"stimulus": stimulus}
        effective_session_id = session_id or self.session_id
        if effective_session_id:
            body["sessionId"] = effective_session_id
        if metadata:
            body["metadata"] = metadata
        return self._post(f"/gateway/{quote(gateway_id)}/message", body)

    def receive_gateway_inbound(
        self,
        gateway_id: str,
        body: Dict[str, Any],
        secret: Optional[str] = None,
    ) -> Any:
        suffix = f"?secret={quote(secret)}" if secret else ""
        return self._post(f"/gateway/{quote(gateway_id)}/inbound{suffix}", body)

    def list_scheduled_jobs(self) -> Any:
        return self._get("/scheduler/jobs")

    def get_scheduled_job(self, job_id: str) -> Any:
        return self._get(f"/scheduler/jobs/{quote(job_id)}")

    def create_scheduled_job(
        self,
        name: str,
        stimulus: str,
        interval_ms: Optional[int] = None,
        enabled: bool = True,
        schedule: Optional[str] = None,
        script: Optional[str] = None,
        no_agent: Optional[bool] = None,
        workdir: Optional[str] = None,
        skills: Optional[list[str]] = None,
    ) -> Any:
        body: Dict[str, Any] = {
            "name": name,
            "stimulus": stimulus,
            "enabled": enabled,
        }
        if schedule is not None:
            body["schedule"] = schedule
        if interval_ms is not None:
            body["intervalMs"] = interval_ms
        if script is not None:
            body["script"] = script
        if no_agent is not None:
            body["noAgent"] = no_agent
        if workdir is not None:
            body["workdir"] = workdir
        if skills is not None:
            body["skills"] = skills
        return self._post(
            "/scheduler/jobs",
            body,
        )

    def update_scheduled_job(
        self,
        job_id: str,
        name: Optional[str] = None,
        stimulus: Optional[str] = None,
        schedule: Optional[str] = None,
        interval_ms: Optional[int] = None,
        enabled: Optional[bool] = None,
        script: Optional[str] = None,
        no_agent: Optional[bool] = None,
        workdir: Optional[str] = None,
        skills: Optional[list[str]] = None,
    ) -> Any:
        body: Dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if stimulus is not None:
            body["stimulus"] = stimulus
        if schedule is not None:
            body["schedule"] = schedule
        if interval_ms is not None:
            body["intervalMs"] = interval_ms
        if enabled is not None:
            body["enabled"] = enabled
        if script is not None:
            body["script"] = script
        if no_agent is not None:
            body["noAgent"] = no_agent
        if workdir is not None:
            body["workdir"] = workdir
        if skills is not None:
            body["skills"] = skills
        return self._post(f"/scheduler/jobs/{quote(job_id)}", body)

    def run_scheduled_job(self, job_id: str) -> Any:
        return self._post(f"/scheduler/jobs/{quote(job_id)}/run", {})

    def run_due_scheduled_jobs(self) -> Any:
        return self._post("/scheduler/run-due", {})

    def set_scheduled_job_enabled(self, job_id: str, enabled: bool) -> Any:
        action = "enable" if enabled else "disable"
        return self._post(f"/scheduler/jobs/{quote(job_id)}/{action}", {})

    def delete_scheduled_job(self, job_id: str) -> Any:
        return self._delete(f"/scheduler/jobs/{quote(job_id)}")
