"""Agentix-mode TUI handlers must never invoke the Hermes agent runtime."""

import sys
import threading
from types import SimpleNamespace

import agentix_backend
from tui_gateway import server


class _FakeBackend:
    instances = []

    def __init__(self, model=None, session_id=None, **_kwargs):
        self.model = model
        self.session_id = session_id
        self.last_result = {}
        self.cancelled = []
        self.approved = []
        self.rejected = []
        type(self).instances.append(self)

    def list_tasks(self, session_id=None):
        return [
            {
                "id": "task-pi",
                "sessionId": session_id or "sess-parent",
                "planId": "plan-1",
                "kind": "luna-message",
                "status": "running",
                "createdAt": "2026-01-01T00:00:00.000Z",
            }
        ]

    def control_task(self, task_id, action):
        self.cancelled.append((task_id, action))
        return {"ok": True, "taskId": task_id, "action": action}

    def list_plans(self):
        return [
            {
                "id": "plan-1",
                "sessionId": "sess-parent",
                "status": "complete",
                "stimulus": "delegate work",
                "taskCount": 1,
                "createdAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-01T00:00:01.000Z",
            }
        ]

    def get_plan(self, plan_id):
        return {
            "execution": {
                "id": plan_id,
                "sessionId": "sess-parent",
                "stimulus": "delegate work",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-01T00:00:01.000Z",
            },
            "tasks": self.list_tasks("sess-parent"),
        }

    def list_approvals(self):
        return [{"id": "task-approval", "sessionId": "sess-parent"}]

    def approve(self, task_id):
        self.approved.append(task_id)
        return {"ok": True, "taskId": task_id}

    def reject(self, task_id, reason=None):
        self.rejected.append((task_id, reason))
        return {"ok": True, "taskId": task_id}

    def branch_session(self, session_id, title=""):
        return {"ok": True, "id": "sess-background", "parentSessionId": session_id}

    def create_session(self, **_kwargs):
        return {"id": "sess-background"}

    def execute(self, prompt, session_id=None, **_kwargs):
        self.session_id = session_id or self.session_id
        self.last_result = {"status": "complete", "taskIds": ["task-background"]}
        return f"Powerhouse completed: {prompt}"


def _install_session(monkeypatch):
    backend = _FakeBackend(session_id="sess-parent")
    session = {
        "agent": SimpleNamespace(_backend=backend, model="test-model"),
        "session_key": "sess-parent",
        "history": [{"role": "user", "content": "parent context"}],
        "history_lock": threading.Lock(),
        "running": False,
    }
    monkeypatch.setitem(server._sessions, "tui-session", session)
    return backend, session


def _call(method, **params):
    response = server.handle_request(
        {
            "jsonrpc": "2.0",
            "id": "test",
            "method": method,
            "params": params,
        }
    )
    assert response is not None
    return response


def test_agentix_delegation_replay_and_approval_are_backend_owned(monkeypatch):
    monkeypatch.setenv("AGENTIX_FRONTEND", "agentix")
    monkeypatch.setattr(agentix_backend, "AgentixBackend", _FakeBackend)
    backend, _session = _install_session(monkeypatch)

    status = _call("delegation.status")["result"]
    assert status["backend"] == "agentix"
    assert status["active"][0]["subagent_id"] == "task-pi"

    interrupted = _call("subagent.interrupt", subagent_id="task-pi")["result"]
    assert interrupted["found"] is True
    assert any(instance.cancelled == [("task-pi", "cancel")] for instance in _FakeBackend.instances)

    saved = _call(
        "spawn_tree.save",
        session_id="tui-session",
        subagents=[{"subagent_id": "untrusted-frontend-copy"}],
    )["result"]
    assert saved["path"] == "agentix-plan://plan-1"
    listed = _call("spawn_tree.list", session_id="tui-session")["result"]
    assert listed["entries"][0]["path"] == "agentix-plan://plan-1"
    loaded = _call("spawn_tree.load", path="agentix-plan://plan-1")["result"]
    assert loaded["subagents"][0]["subagent_id"] == "task-pi"

    approval = _call(
        "approval.respond", session_id="tui-session", choice="approve"
    )["result"]
    assert approval["resolved"] == 1
    assert backend.approved == ["task-approval"]

    rollback = _call("rollback.list", session_id="tui-session")["result"]
    assert rollback["enabled"] is False
    assert "Powerhouse" in rollback["reason"]


def test_agentix_background_prompt_uses_powerhouse_without_importing_aiagent(monkeypatch):
    monkeypatch.setenv("AGENTIX_FRONTEND", "agentix")
    monkeypatch.setattr(agentix_backend, "AgentixBackend", _FakeBackend)
    monkeypatch.setitem(sys.modules, "run_agent", None)
    _backend, _session = _install_session(monkeypatch)
    completed = threading.Event()
    emitted = []

    def capture(event, sid, payload=None):
        emitted.append((event, sid, payload or {}))
        if event == "background.complete":
            completed.set()

    monkeypatch.setattr(server, "_emit", capture)
    started = _call(
        "prompt.background",
        session_id="tui-session",
        text="background audit",
    )["result"]

    assert started["backend"] == "agentix"
    assert completed.wait(2)
    event = next(item for item in emitted if item[0] == "background.complete")
    assert event[2]["text"] == "Powerhouse completed: background audit"
    assert event[2]["task_ids"] == ["task-background"]
