"""
Python drop-in for AIAgent. Auto-starts the Node.js bridge subprocess
and delegates all agent operations to it via HTTP.

When imported with AGENTIX_FRONTEND=hermes env var, this module's AIAgent
replaces the native Hermes AIAgent so all code paths use the bridge.
"""

import os
import sys
import json
import subprocess
import threading
import time
import urllib.request
import urllib.error
from typing import Any, Dict, Optional, Callable

BRIDGE_PORT = int(os.environ.get("AGENTIX_BRIDGE_PORT", "3456"))
BRIDGE_URL = f"http://127.0.0.1:{BRIDGE_PORT}"

# Global bridge process handle
_bridge_process: Optional[subprocess.Popen] = None
_bridge_lock = threading.Lock()


def _get_bridge_url() -> str:
    return os.environ.get("AGENTIX_BRIDGE_URL") or os.environ.get("HERMES_BRIDGE_URL") or BRIDGE_URL


def _bridge_healthcheck() -> bool:
    """Check if the bridge is running and responsive."""
    try:
        req = urllib.request.Request(f"{_get_bridge_url()}/health")
        with urllib.request.urlopen(req, timeout=2000) as resp:
            return resp.status == 200
    except Exception:
        return False


def ensure_bridge_running():
    """Start the Node.js bridge as a detached subprocess if not already running."""
    global _bridge_process

    with _bridge_lock:
        if _bridge_healthcheck():
            return

        # Find project root - parent of hermes-agent/
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        bridge_entry = os.path.join(project_root, "dist", "bridge", "entry.js")

        if not os.path.exists(bridge_entry):
            raise RuntimeError(
                f"Bridge entry not found at {bridge_entry}. "
                "Please run 'npm run build' first."
            )

        env = {
            **os.environ,
            "AGENTIX_BRIDGE_PORT": str(BRIDGE_PORT),
            "AGENTIX_BRIDGE_URL": _get_bridge_url(),
        }

        _bridge_process = subprocess.Popen(
            [sys.executable, "-u", bridge_entry],  # -u for unbuffered stdout
            cwd=project_root,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

        # Wait for bridge to be ready
        for _ in range(50):  # 5 second timeout
            time.sleep(0.1)
            if _bridge_healthcheck():
                return

        raise RuntimeError("Bridge subprocess failed to start within 5 seconds.")


class AgentixBackend:
    """
    AIAgent drop-in that routes all agent operations to the Node.js bridge
    via HTTP, which in turn forwards to the actual AI provider.

    Supports both streaming (callback-based) and non-streaming execution.
    """

    def __init__(self, model: Optional[str] = None, **kwargs):
        self.model = model or os.environ.get("AGENTIX_MODEL")
        self.session_id = kwargs.get("session_id", f"session-{os.getpid()}")
        self._ensure_started()

    def _ensure_started(self):
        """Lazily start the bridge on first agent operation."""
        ensure_bridge_running()

    def _post(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        """POST JSON to the bridge and return the parsed response."""
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{_get_bridge_url()}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def execute(
        self,
        stimulus: str,
        session_id: Optional[str] = None,
        stream_callback: Optional[Callable[[str], None]] = None,
        **kwargs,
    ) -> str:
        """
        Execute a stimulus through the bridge. If stream_callback is provided,
        yields deltas as they arrive. Otherwise returns complete response.
        """
        body: Dict[str, Any] = {"stimulus": stimulus}
        if session_id:
            body["sessionId"] = session_id
        if self.model:
            body["model"] = self.model

        # Use streaming endpoint
        path = "/execute/stream"
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{_get_bridge_url()}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        response = ""
        with urllib.request.urlopen(req, timeout=120) as resp:
            for line in resp:
                line = line.decode("utf-8").strip()
                if not line.startswith("data: "):
                    continue
                payload = line[6:].replace("\\n", "\n")
                if payload == "[DONE]":
                    break
                try:
                    parsed = json.loads(payload)
                    if parsed.get("error"):
                        raise RuntimeError(parsed["error"])
                    if parsed.get("delta"):
                        delta = parsed["delta"]
                        if stream_callback:
                            stream_callback(delta)
                        response += delta
                except json.JSONDecodeError:
                    # Plain text delta
                    if stream_callback:
                        stream_callback(payload)
                    response += payload

        return response

    def get_sessions(self):
        return self._post("/sessions", {})

    def create_session(self, model=None):
        body = {}
        if model:
            body["model"] = model
        return self._post("/sessions", body)

    def delete_session(self, session_id):
        path = f"/sessions/{session_id}"
        req = urllib.request.Request(
            f"{_get_bridge_url()}{path}",
            method="DELETE",
        )
        with urllib.request.urlopen(req, timeout=5000):
            pass

    def memory_search(self, query: str):
        import urllib.parse
        path = f"/memory/search?q={urllib.parse.quote(query)}"
        req = urllib.request.Request(f"{_get_bridge_url()}{path}")
        with urllib.request.urlopen(req, timeout=10_000) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def list_tools(self):
        return self._post("/tools", {})

    def close(self):
        """Clean up the agent session."""
        try:
            self.delete_session(self.session_id)
        except Exception:
            pass

    def __repr__(self):
        return f"AgentixBackend(model={self.model!r}, session={self.session_id!r})"