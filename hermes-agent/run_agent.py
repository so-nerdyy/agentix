"""
Minimal Hermes run_agent.py.

Provides the native AIAgent class as a fallback when Agentix is not the frontend.
When AGENTIX_FRONTEND=hermes is set, this module rebinds AIAgent to AgentixBackend
so any code that imports AIAgent from run_agent gets the Agentix bridge instead.

The real full run_agent.py (~4300 lines) was deleted and is replaced by this stub.
"""

import os
import sys

# Ensure the project root is on the path so agentix_backend can be imported
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)


def _get_logger():
    """Simple logger that writes to stderr."""
    import logging
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    return logging.getLogger(__name__)


logger = _get_logger()


class AIAgent:
    """
    Minimal native Hermes agent stub.
    
    When AGENTIX_FRONTEND=hermes, this class is replaced (rebinding AIAgent in this
    module's namespace) by AgentixBackend so all code paths use the Agentix bridge.
    """

    def __init__(self, model=None, session_id=None, **kwargs):
        self.model = model or os.environ.get("AGENTIX_MODEL")
        self.session_id = session_id or f"session-{os.getpid()}"
        self._history = []

    def execute(self, stimulus, stream_callback=None, **kwargs):
        """Execute a stimulus. Override in subclasses for real behavior."""
        result = f"[Native Hermes stub] Received: {stimulus[:50]}..."
        if stream_callback:
            for char in result:
                stream_callback(char)
        return result

    def get_sessions(self):
        return []

    def create_session(self, model=None):
        return {"id": self.session_id}

    def delete_session(self, session_id):
        pass

    def memory_search(self, query):
        return []

    def list_tools(self):
        return []

    def close(self):
        pass

    def __repr__(self):
        return f"AIAgent(model={self.model!r}, session={self.session_id!r})"


# ---------------------------------------------------------------------------
# Agentix frontend rebind — this fires when Agentix launches Hermes
# ---------------------------------------------------------------------------
if os.environ.get("AGENTIX_FRONTEND") == "hermes":
    try:
        from agentix_backend import AgentixBackend
        AIAgent = AgentixBackend  # noqa: F811
        logger.info("AIAgent rebind: using AgentixBackend (AGENTIX_FRONTEND=hermes)")
    except Exception as e:
        logger.warning("AgentixBackend rebind failed: %s", e)


if __name__ == "__main__":
    import fire
    fire.Fire(AIAgent)