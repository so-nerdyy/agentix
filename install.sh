#!/usr/bin/env sh
set -eu

PACKAGE="${AGENTIX_PACKAGE:-agentix}"
DRY_RUN="${AGENTIX_DRY_RUN:-0}"
SKIP_SETUP="${AGENTIX_SKIP_SETUP:-0}"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

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
  agentix version
fi

printf '\nNext steps:\n'
if [ "$SKIP_SETUP" != "1" ]; then
  printf '  agentix setup\n'
fi
printf '  agentix\n\n'
printf 'Use AGENTIX_PACKAGE to install a tag or tarball, for example:\n'
printf '  AGENTIX_PACKAGE=agentix@2.1.0 curl -fsSL <url>/install.sh | sh\n'
