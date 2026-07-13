import os
import json
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "hermes-agent"))

from agentix_backend import AgentixBackend  # noqa: E402


class _StalledStreamHandler(BaseHTTPRequestHandler):
    started = threading.Event()
    release = threading.Event()

    def do_POST(self) -> None:
        if self.path != "/execute/stream":
            self.send_error(404)
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length:
            self.rfile.read(content_length)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        self.wfile.flush()
        self.started.set()
        while not self.release.wait(0.05):
            try:
                self.wfile.write(b": agentix-heartbeat\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                return

    def log_message(self, _format: str, *_args: object) -> None:
        return


class _ResultStreamHandler(BaseHTTPRequestHandler):
    request_body: dict[str, object] = {}

    def do_POST(self) -> None:
        if self.path not in {"/execute/stream", "/sessions"}:
            self.send_error(404)
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length) if content_length else b"{}"
        type(self).request_body = json.loads(raw.decode("utf-8"))
        if self.path == "/sessions":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"id":"sess-created"}')
            self.wfile.flush()
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        self.wfile.write(b'data: {"delta":"hello "}\n\n')
        self.wfile.write(b'data: {"delta":"world"}\n\n')
        self.wfile.write(
            b'data: {"type":"result","sessionId":"sess-gateway",'
            b'"status":"complete","taskIds":["task-1"]}\n\n'
        )
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def log_message(self, _format: str, *_args: object) -> None:
        return


class AgentixBackendCancellationTests(unittest.TestCase):
    def setUp(self) -> None:
        _StalledStreamHandler.started.clear()
        _StalledStreamHandler.release.clear()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _StalledStreamHandler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()

    def tearDown(self) -> None:
        _StalledStreamHandler.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(5)

    def test_interrupt_unblocks_a_stalled_stream_without_blocking_the_caller(self) -> None:
        backend = AgentixBackend.__new__(AgentixBackend)
        backend.model = None
        backend.session_id = None
        backend._interrupt_event = threading.Event()
        backend._response_lock = threading.Lock()
        backend._active_response = None
        backend.was_interrupted = False

        result: dict[str, object] = {}

        def execute() -> None:
            try:
                result["response"] = backend.execute("cancel this stream")
            except BaseException as error:  # Preserve failures for the test thread.
                result["error"] = error

        bridge_url = f"http://127.0.0.1:{self.server.server_port}"
        with patch.dict(os.environ, {"AGENTIX_BRIDGE_URL": bridge_url}, clear=False):
            worker = threading.Thread(target=execute, daemon=True)
            worker.start()
            self.assertTrue(_StalledStreamHandler.started.wait(5), "stream request never started")

            started = time.monotonic()
            backend.interrupt()
            interrupt_duration = time.monotonic() - started
            worker.join(5)

        self.assertLess(interrupt_duration, 1.0, "interrupt blocked on HTTPResponse.close()")
        self.assertFalse(worker.is_alive(), "stream reader remained blocked after interrupt")
        self.assertNotIn("error", result)
        self.assertEqual(result.get("response"), "")
        self.assertTrue(backend.was_interrupted)

    def test_preserved_interrupt_cancels_before_opening_the_stream(self) -> None:
        backend = AgentixBackend.__new__(AgentixBackend)
        backend.model = None
        backend.session_id = "sess-precreated"
        backend._interrupt_event = threading.Event()
        backend._response_lock = threading.Lock()
        backend._active_response = None
        backend.was_interrupted = True
        backend.last_result = {}
        backend._interrupt_event.set()

        response = backend.execute("must not open HTTP", preserve_interrupt=True)

        self.assertEqual(response, "")
        self.assertTrue(backend.was_interrupted)
        self.assertEqual(
            backend.last_result,
            {
                "sessionId": "sess-precreated",
                "status": "cancelled",
                "taskIds": [],
            },
        )


class AgentixBackendStreamingProtocolTests(unittest.TestCase):
    def setUp(self) -> None:
        _ResultStreamHandler.request_body = {}
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _ResultStreamHandler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(5)

    def test_stream_forwards_gateway_policy_and_tracks_terminal_result(self) -> None:
        backend = AgentixBackend.__new__(AgentixBackend)
        backend.model = None
        backend.session_id = None
        backend._interrupt_event = threading.Event()
        backend._response_lock = threading.Lock()
        backend._active_response = None
        backend.was_interrupted = False
        backend.last_result = {}
        streamed: list[str] = []

        bridge_url = f"http://127.0.0.1:{self.server.server_port}"
        with patch.dict(os.environ, {"AGENTIX_BRIDGE_URL": bridge_url}, clear=False):
            response = backend.execute(
                "route through Powerhouse",
                stream_callback=streamed.append,
                toolsets=[],
                skills=["release-audit"],
                gateway_id="discord",
                metadata={"chatId": "channel-1"},
                deliver=False,
            )

        self.assertEqual(response, "hello world")
        self.assertEqual(streamed, ["hello ", "world"])
        self.assertEqual(backend.session_id, "sess-gateway")
        self.assertEqual(
            backend.last_result,
            {
                "sessionId": "sess-gateway",
                "status": "complete",
                "taskIds": ["task-1"],
            },
        )
        self.assertEqual(
            _ResultStreamHandler.request_body,
            {
                "stimulus": "route through Powerhouse",
                "toolsets": [],
                "skills": ["release-audit"],
                "gatewayId": "discord",
                "metadata": {"chatId": "channel-1"},
                "deliver": False,
            },
        )

    def test_create_session_forwards_model_policy_without_undefined_skills(self) -> None:
        backend = AgentixBackend.__new__(AgentixBackend)
        bridge_url = f"http://127.0.0.1:{self.server.server_port}"
        with patch.dict(os.environ, {"AGENTIX_BRIDGE_URL": bridge_url}, clear=False):
            result = backend.create_session(
                model="test-model",
                provider="kilo",
                base_url="https://api.kilo.ai/api/gateway",
                toolsets=[],
                skills=[],
                metadata={"source": "frontend"},
            )

        self.assertEqual(result, {"id": "sess-created"})
        self.assertEqual(
            _ResultStreamHandler.request_body,
            {
                "model": "test-model",
                "provider": "kilo",
                "baseUrl": "https://api.kilo.ai/api/gateway",
                "toolsets": [],
                "skills": [],
                "metadata": {"source": "frontend"},
            },
        )


if __name__ == "__main__":
    unittest.main()
