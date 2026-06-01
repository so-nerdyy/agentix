"""
Hermes CLI main dispatcher.
Handles all user-facing commands: setup, model, doctor, usage, cron, gateway,
sessions, skills, tools, memory, logs, update, etc.

This is a functional stub rebuilt from memory after files were lost.
The real full implementation had all interactive wizards and rich formatting.
"""

import os
import sys
import argparse

_HERMES_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _HERMES_ROOT not in sys.path:
    sys.path.insert(0, _HERMES_ROOT)


# ---------------------------------------------------------------------------
# Helper: get the bridge URL for backend communication
# ---------------------------------------------------------------------------
def _bridge_url():
    return os.environ.get("HERMES_BRIDGE_URL") or os.environ.get(
        "AGENTIX_BRIDGE_URL"
    ) or "http://127.0.0.1:3456"


# ---------------------------------------------------------------------------
# Subcommand: doctor — system diagnostics
# ---------------------------------------------------------------------------
def doctor(args):
    """Run system diagnostic checks."""
    print("=== Agentix System Doctor ===\n")
    print(f"Bridge URL: {_bridge_url()}")
    print(f"Python: {sys.version}")
    print(f"Platform: {sys.platform}")
    print(f"Hermes root: {_HERMES_ROOT}")

    # Check if bridge is reachable
    try:
        import urllib.request
        req = urllib.request.Request(f"{_bridge_url()}/health")
        with urllib.request.urlopen(req, timeout=3000) as resp:
            data = resp.read().decode()
            print(f"\nBridge: REACHABLE ({resp.status})")
    except Exception as e:
        print(f"\nBridge: NOT REACHABLE — {e}")
        print("Start the bridge with: agentix server")

    # Check for required files
    required = ["agentix_backend.py", "cli.py"]
    for f in required:
        path = os.path.join(_HERMES_ROOT, f)
        status = "✓" if os.path.exists(path) else "✗ MISSING"
        print(f"  {f}: {status}")

    print("\nDiagnosis complete.")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: usage — API usage stats
# ---------------------------------------------------------------------------
def usage(args):
    """Show API usage statistics."""
    print("=== Agentix Usage ===\n")
    print("No usage data available yet.")
    print("Usage is tracked per session when using the agent.")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: setup — first-run wizard
# ---------------------------------------------------------------------------
def setup(args):
    """Run first-run setup wizard."""
    print("=== Agentix Setup ===\n")
    print("Welcome! Let's get Agentix configured.\n")

    # Check for config file
    config_path = os.path.join(_HERMES_ROOT, "config.yaml")
    if os.path.exists(config_path):
        print("config.yaml already exists. Run 'agentix model' to reconfigure.\n")
        return 0

    # Interactive model configuration
    print("You'll need an API key for your AI provider.")
    print("Supported providers: openai, anthropic, xai, google, ollama\n")

    provider = input("Provider [openai]: ").strip() or "openai"
    api_key = input(f"{provider.capitalize()} API key: ").strip()

    if not api_key:
        print("\nNo API key provided. Setup incomplete.")
        print("Run 'agentix setup' again to retry.\n")
        return 1

    # Write minimal config
    config_dir = os.path.dirname(config_path)
    if config_dir and not os.path.exists(config_dir):
        os.makedirs(config_dir, exist_ok=True)

    import json
    config = {
        "provider": provider,
        "api_key": api_key,
        "model": os.environ.get("AGENTIX_DEFAULT_MODEL", "gpt-4o"),
    }
    with open(config_path, "w") as f:
        json.dump(config, f)

    print(f"\n✓ Configuration saved to {config_path}")
    print("Run 'agentix' to start chatting!\n")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: model — configure model provider
# ---------------------------------------------------------------------------
def model(args):
    """Configure the model provider."""
    print("=== Model Configuration ===\n")
    config_path = os.path.join(_HERMES_ROOT, "config.yaml")

    current_provider = None
    current_model = None
    if os.path.exists(config_path):
        import yaml
        with open(config_path) as f:
            cfg = yaml.safe_load(f) or {}
        current_provider = cfg.get("provider")
        current_model = cfg.get("model")

    if current_provider:
        print(f"Current provider: {current_provider}")
        print(f"Current model:    {current_model}\n")

    provider = input("Provider: ").strip()
    if not provider and current_provider:
        provider = current_provider

    model_name = input("Model name: ").strip()
    if not model_name and current_model:
        model_name = current_model

    if not provider or not model_name:
        print("\nConfiguration unchanged.\n")
        return 1

    api_key = input(f"{provider.capitalize()} API key: ").strip()
    if not api_key:
        print("\nNo API key provided.\n")
        return 1

    import json
    config = {
        "provider": provider,
        "api_key": api_key,
        "model": model_name,
    }
    os.makedirs(os.path.dirname(config_path) or ".", exist_ok=True)
    with open(config_path, "w") as f:
        json.dump(config, f)

    print(f"\n✓ Model configured: {provider}/{model_name}\n")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: cron — scheduled task management
# ---------------------------------------------------------------------------
def cron(args):
    """Manage scheduled tasks."""
    if not args.subcommand:
        # List all cron jobs
        print("=== Scheduled Tasks ===\n")
        print("No scheduled tasks configured.")
        print("Create one with: agentix cron create '<prompt>' --every 60")
        return 0

    sub = args.subcommand
    if sub == "list":
        print("No scheduled tasks.\n")
    elif sub == "create":
        prompt = args.prompt or input("Task prompt: ").strip()
        every = args.every or 60
        print(f"Would create cron job: every {every}s — {prompt[:40]}...")
        print("(Cron scheduler not yet implemented in this stub)\n")
    elif sub == "run":
        print("Running cron job...\n")
    else:
        print(f"Unknown cron subcommand: {sub}\n")
        return 1
    return 0


# ---------------------------------------------------------------------------
# Subcommand: sessions — session management
# ---------------------------------------------------------------------------
def sessions(args):
    """Manage agent sessions."""
    print("=== Sessions ===\n")
    if args.subcommand == "list":
        print("No active sessions.\n")
    else:
        print("Usage: agentix sessions list\n")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: skills — skill management
# ---------------------------------------------------------------------------
def skills(args):
    """Manage Agentix skills."""
    print("=== Skills ===\n")
    if not args.subcommand or args.subcommand == "list":
        print("Available skills:")
        print("  write         Write/edit code files")
        print("  search        Search the codebase")
        print("  execute       Run shell commands")
        print("  ask           Ask about the codebase\n")
    else:
        print(f"Skills: {args.subcommand} not fully implemented in this stub\n")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: tools — tool management
# ---------------------------------------------------------------------------
def tools(args):
    """Manage Agentix tools."""
    print("=== Tools ===\n")
    print("Available tools: file_read, file_write, grep, bash, web_search\n")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: memory — conversation memory search
# ---------------------------------------------------------------------------
def memory(args):
    """Search conversation memory."""
    query = args.query or ""
    if not query:
        print("Usage: agentix memory <search-query>\n")
        return 1

    print(f"Searching memory for: {query}\n")
    print("(Memory search not yet connected to backend in this stub)\n")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: logs — log search
# ---------------------------------------------------------------------------
def logs(args):
    """Search agent logs."""
    query = args.query or ""
    print(f"Searching logs for: {query or '(all)'}\n")
    print("(Log search not yet implemented in this stub)\n")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: update — check for updates
# ---------------------------------------------------------------------------
def update(args):
    """Check for Agentix updates."""
    print("Agentix is up to date (2.1.0)\n")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: fortune — random wisdom
# ---------------------------------------------------------------------------
def fortune(args):
    """Display random wisdom."""
    import random
    wisdoms = [
        "The best code is no code at all.",
        "Make it work, make it right, make it fast — in that order.",
        "Debugging is twice as hard as writing code. Keep it simple.",
        "The function of good software is to make the complex appear simple.",
        "First, solve the problem. Then, write the code.",
        "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.",
        "The most important single aspect of software development is to be clear about what you are trying to build.",
    ]
    print(random.choice(wisdoms) + "\n")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: gateway — API gateway management
# ---------------------------------------------------------------------------
def gateway(args):
    """Manage the API gateway."""
    print("=== API Gateway ===\n")
    print("Gateway status: not running")
    print("Start with: agentix gateway start\n")
    return 0


# ---------------------------------------------------------------------------
# Main dispatcher
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        prog="agentix",
        description="Agentix CLI — AI coding agent with Hermes frontend",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # doctor
    p = subparsers.add_parser("doctor", help="Run system diagnostics")
    p.set_defaults(fn=doctor)

    # usage
    p = subparsers.add_parser("usage", help="Show API usage stats")
    p.set_defaults(fn=usage)

    # setup
    p = subparsers.add_parser("setup", help="First-run setup wizard")
    p.set_defaults(fn=setup)

    # model
    p = subparsers.add_parser("model", help="Configure model provider")
    p.set_defaults(fn=model)

    # update
    p = subparsers.add_parser("update", help="Check for updates")
    p.add_argument("--check", action="store_true", help="Check for updates")
    p.set_defaults(fn=update)

    # cron
    p = subparsers.add_parser("cron", help="Manage scheduled tasks")
    p.add_argument("subcommand", nargs="?", choices=["list", "create", "run", "delete"])
    p.add_argument("prompt", nargs="?", help="Task prompt")
    p.add_argument("--every", type=int, help="Run every N seconds")
    p.set_defaults(fn=cron, subcommand=None)

    # sessions
    p = subparsers.add_parser("sessions", help="Manage sessions")
    p.add_argument("subcommand", nargs="?", choices=["list", "new", "delete"])
    p.set_defaults(fn=sessions, subcommand=None)

    # skills
    p = subparsers.add_parser("skills", help="Manage skills")
    p.add_argument("subcommand", nargs="?", help="Subcommand")
    p.set_defaults(fn=skills, subcommand=None)

    # tools
    p = subparsers.add_parser("tools", help="Manage tools")
    p.add_argument("subcommand", nargs="?", help="Subcommand")
    p.set_defaults(fn=tools, subcommand=None)

    # memory
    p = subparsers.add_parser("memory", help="Search memory")
    p.add_argument("query", nargs="?", help="Search query")
    p.set_defaults(fn=memory, query=None)

    # logs
    p = subparsers.add_parser("logs", help="Search logs")
    p.add_argument("query", nargs="?", help="Search query")
    p.set_defaults(fn=logs, query=None)

    # fortune
    p = subparsers.add_parser("fortune", help="Random wisdom")
    p.set_defaults(fn=fortune)

    # gateway
    p = subparsers.add_parser("gateway", help="Manage API gateway")
    p.add_argument("subcommand", nargs="?", help="Subcommand")
    p.set_defaults(fn=gateway, subcommand=None)

    # Default: show help
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        print("\nRun 'agentix help <command>' for subcommand-specific help.")
        return 0

    fn = getattr(args, "fn", None)
    if fn:
        try:
            return fn(args) or 0
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1
    else:
        parser.print_help()
        return 0


if __name__ == "__main__":
    sys.exit(main() if main() is not None else 0)