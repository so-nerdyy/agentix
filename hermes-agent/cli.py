"""
Minimal Hermes CLI entry point.
The real full CLI lives in hermes_cli/main.py - this is a lightweight stub
for use when the full Hermes package isn't available.
"""

import sys
import os

# Add project root to path
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)


def AIAgent(*args, **kwargs):
    """
    Factory function that returns an AgentixBackend instance.
    This replaces the native Hermes AIAgent when Agentix is the frontend.
    """
    # Avoid circular import
    from agentix_backend import AgentixBackend
    return AgentixBackend(*args, **kwargs)


def main():
    """Simple CLI stub that delegates to hermes_cli.main if available."""
    # Try to import the real Hermes CLI
    try:
        from hermes_cli.main import main as hermes_main
        sys.exit(hermes_main())
    except ImportError:
        print("Hermes CLI not fully installed. Run 'agentix setup' first.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()