"""Architecture guards for Hermes-derived gateway I/O in Agentix mode."""

import asyncio
import threading
from unittest.mock import patch

import pytest

from gateway.config import Platform
from gateway.run import GatewayRunner
from gateway.session import SessionSource


def _make_runner() -> GatewayRunner:
    runner = object.__new__(GatewayRunner)
    runner.adapters = {}
    runner._running_agents = {}
    runner._running_agents_ts = {}
    runner._pending_messages = {}
    runner._session_run_generation = {"discord:channel": 7}
    runner._agent_cache = {}
    runner._agent_cache_lock = None
    runner._agentix_gateway_backends = {}
    return runner


def _make_source() -> SessionSource:
    return SessionSource(
        platform=Platform.DISCORD,
        chat_id="channel",
        chat_name="Agentix test",
        chat_type="group",
        user_id="user-1",
        user_name="tester",
        thread_id=None,
    )


class _FakeBackend:
    instances = []

    def __init__(self, session_id=None, **_kwargs):
        self.model = _kwargs.get("model")
        self.session_id = session_id
        self.last_result = {}
        self.was_interrupted = False
        self.calls = []
        self.created = []
        self.interrupt_reason = None
        type(self).instances.append(self)

    def execute(self, stimulus, **kwargs):
        self.calls.append((stimulus, kwargs))
        self.session_id = "sess-agentix-gateway"
        self.last_result = {
            "sessionId": self.session_id,
            "status": "complete",
            "taskIds": ["task-agentix"],
        }
        return "Powerhouse response"

    @property
    def request_active(self):
        return False

    def reset_interrupt(self):
        self.was_interrupted = False
        self.interrupt_reason = None

    def create_session(self, **kwargs):
        self.created.append(kwargs)
        self.session_id = "sess-agentix-precreated"
        return {"id": self.session_id}

    def interrupt(self, reason=None):
        self.was_interrupted = True
        self.interrupt_reason = reason


class _BlockingBackend(_FakeBackend):
    started = threading.Event()
    released = threading.Event()

    def execute(self, stimulus, **kwargs):
        self.calls.append((stimulus, kwargs))
        type(self).started.set()
        type(self).released.wait(5)
        self.last_result = {
            "sessionId": self.session_id,
            "status": "cancelled",
            "taskIds": [],
        }
        return ""

    def interrupt(self, reason=None):
        super().interrupt(reason)
        type(self).released.set()


@pytest.mark.asyncio
async def test_agentix_mode_routes_gateway_turn_without_native_aiagent(monkeypatch):
    monkeypatch.setenv("AGENTIX_FRONTEND", "agentix")
    _FakeBackend.instances.clear()
    runner = _make_runner()

    with patch("agentix_backend.AgentixBackend", _FakeBackend):
        result = await runner._run_agent(
            message="inspect the repository",
            context_prompt="must not become a second loop",
            history=[],
            source=_make_source(),
            session_id="hermes-mapping-only",
            session_key="discord:channel",
            run_generation=7,
        )

    backend = _FakeBackend.instances[0]
    assert result["final_response"] == "Powerhouse response"
    assert result["session_id"] == "sess-agentix-gateway"
    assert result["agentix_backend"] is True
    assert backend.created == [
        {
            "model": None,
            "metadata": {
                "transport": "hermes-derived-gateway",
                "platform": "discord",
                "userId": "user-1",
                "chatId": "channel",
            },
        }
    ]
    assert backend.calls == [
        (
            "inspect the repository",
            {
                "session_id": "sess-agentix-precreated",
                "gateway_id": "discord",
                "metadata": {
                    "transport": "hermes-derived-gateway",
                    "platform": "discord",
                    "userId": "user-1",
                    "chatId": "channel",
                },
                "deliver": False,
                "preserve_interrupt": True,
            },
        )
    ]
    assert runner._running_agents == {}


@pytest.mark.asyncio
async def test_gateway_stop_interrupts_agentix_stream_and_discards_stale_result(monkeypatch):
    monkeypatch.setenv("AGENTIX_FRONTEND", "agentix")
    _BlockingBackend.instances.clear()
    _BlockingBackend.started.clear()
    _BlockingBackend.released.clear()
    runner = _make_runner()
    source = _make_source()

    with patch("agentix_backend.AgentixBackend", _BlockingBackend):
        task = asyncio.create_task(
            runner._run_agent(
                message="long running task",
                context_prompt="",
                history=[],
                source=source,
                session_id="hermes-mapping-only",
                session_key="discord:channel",
                run_generation=7,
            )
        )
        assert await asyncio.to_thread(_BlockingBackend.started.wait, 2)
        backend = runner._running_agents["discord:channel"]
        await runner._interrupt_and_clear_session(
            "discord:channel",
            source,
            interrupt_reason="user requested stop",
            invalidation_reason="gateway stop test",
        )
        result = await asyncio.wait_for(task, 2)

    assert backend.was_interrupted is True
    assert backend.interrupt_reason == "user requested stop"
    assert result["interrupted"] is True
    assert result["completed"] is False
    assert runner._running_agents == {}


def test_session_eviction_clears_agentix_backend_cache():
    runner = _make_runner()
    backend = _FakeBackend()
    runner._agentix_gateway_backends["discord:channel"] = backend

    runner._evict_cached_agent("discord:channel")

    assert runner._agentix_gateway_backends == {}
    assert backend.was_interrupted is True
    assert backend.interrupt_reason == "gateway session evicted"
