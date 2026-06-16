#!/usr/bin/env sh
set -eu

PACKAGE="${AGENTIX_PACKAGE:-agentix}"
DRY_RUN="${AGENTIX_DRY_RUN:-0}"
SKIP_SETUP="${AGENTIX_SKIP_SETUP:-0}"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Install Agentix globally with npm.

Environment:
  AGENTIX_PACKAGE     Package, version, or tarball to install. Default: agentix
  AGENTIX_DRY_RUN     Set to 1 to print actions without installing.
  AGENTIX_SKIP_SETUP  Set to 1 to omit setup from the next-step hint.

Examples:
  curl -fsSL https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.sh | sh
  AGENTIX_PACKAGE=agentix@2.1.0 curl -fsSL https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.sh | sh
EOF
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
  "")
    ;;
  *)
    fail "Unknown argument: $1. Use --help for usage."
    ;;
esac

command -v node >/dev/null 2>&1 || fail "Node.js 18+ is required before installing Agentix. Install Node.js, then rerun this script."
command -v npm >/dev/null 2>&1 || fail "npm is required before installing Agentix. Install Node.js/npm, then rerun this script."

NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js 18+ is required before installing Agentix. Found $(node -v)."
fi

printf 'Installing Agentix package: %s\n' "$PACKAGE"
printf 'Command: npm install -g %s\n' "$PACKAGE"

if [ "$DRY_RUN" != "1" ]; then
  npm install -g "$PACKAGE"
  agentix version >/dev/null 2>&1 || fail "Agentix installed, but the global agentix command failed to run."
  agentix version
fi

printf '\nNext steps:\n'
if [ "$SKIP_SETUP" != "1" ]; then
  printf '  agentix setup\n'
fi
printf '  agentix\n\n'
printf 'Use AGENTIX_PACKAGE to install a tag or tarball, for example:\n'
printf '  AGENTIX_PACKAGE=agentix@2.1.0 curl -fsSL https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.sh | sh\n'
