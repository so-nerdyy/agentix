#!/usr/bin/env sh
set -eu

DEFAULT_PACKAGE="@nerdyy/agentix"
PACKAGE="${AGENTIX_PACKAGE:-$DEFAULT_PACKAGE}"
VERSION="${AGENTIX_VERSION:-}"
RELEASE_BASE_URL="${AGENTIX_RELEASE_BASE_URL:-}"
RELEASE_ARTIFACT_BASE="${AGENTIX_RELEASE_ARTIFACT_BASE:-nerdyy-agentix}"
DRY_RUN="${AGENTIX_DRY_RUN:-0}"
SKIP_SETUP="${AGENTIX_SKIP_SETUP:-0}"
EXPECTED_SHA256="${AGENTIX_EXPECTED_SHA256:-}"
TEMP_DIR=""

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Install Agentix globally with npm.

Environment:
  AGENTIX_PACKAGE     Package, version, or tarball to install. Default: @nerdyy/agentix
  AGENTIX_VERSION     Download and verify a GitHub release asset, for example 2.1.0.
  AGENTIX_RELEASE_BASE_URL  Override release asset base URL.
  AGENTIX_RELEASE_ARTIFACT_BASE  Override release manifest basename.
  AGENTIX_EXPECTED_SHA256  Optional SHA256 for local tarball installs.
  AGENTIX_DRY_RUN     Set to 1 to print actions without installing.
  AGENTIX_SKIP_SETUP  Set to 1 to omit setup from the next-step hint.

Examples:
  curl -fsSL https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.sh | sh
  AGENTIX_PACKAGE=@nerdyy/agentix@2.1.8 curl -fsSL https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.sh | sh
  AGENTIX_VERSION=2.1.0 curl -fsSL https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.sh | sh
EOF
}

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT

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

command -v node >/dev/null 2>&1 || fail "Node.js 20+ is required before installing Agentix. Install Node.js, then rerun this script."
command -v npm >/dev/null 2>&1 || fail "npm is required before installing Agentix. Install Node.js/npm, then rerun this script."

NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js 20+ is required before installing Agentix. Found $(node -v)."
fi

if [ -n "$VERSION" ] && [ "$PACKAGE" = "$DEFAULT_PACKAGE" ]; then
  command -v curl >/dev/null 2>&1 || fail "curl is required for AGENTIX_VERSION release installs."
  TEMP_DIR="$(mktemp -d)"
  if [ -z "$RELEASE_BASE_URL" ]; then
    RELEASE_BASE_URL="https://github.com/so-nerdyy/agentix/releases/download/v$VERSION"
  fi
  MANIFEST_URL="$RELEASE_BASE_URL/$RELEASE_ARTIFACT_BASE-$VERSION-manifest.json"
  MANIFEST_PATH="$TEMP_DIR/manifest.json"
  printf 'Downloading Agentix release manifest: %s\n' "$MANIFEST_URL"
  curl -fsSL "$MANIFEST_URL" -o "$MANIFEST_PATH"
  TARBALL_NAME="$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); if(!m.tarball||!m.sha256) process.exit(2); console.log(m.tarball)" "$MANIFEST_PATH")" || fail "Release manifest is missing tarball."
  EXPECTED_SHA256="$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); if(!m.sha256) process.exit(2); console.log(m.sha256)" "$MANIFEST_PATH")" || fail "Release manifest is missing sha256."
  PACKAGE="$TEMP_DIR/$TARBALL_NAME"
  printf 'Downloading Agentix release tarball: %s/%s\n' "$RELEASE_BASE_URL" "$TARBALL_NAME"
  curl -fsSL "$RELEASE_BASE_URL/$TARBALL_NAME" -o "$PACKAGE"
fi

if [ -n "$EXPECTED_SHA256" ]; then
  [ -f "$PACKAGE" ] || fail "AGENTIX_EXPECTED_SHA256 requires AGENTIX_PACKAGE to be a local tarball path."
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SHA256="$(sha256sum "$PACKAGE" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL_SHA256="$(shasum -a 256 "$PACKAGE" | awk '{print $1}')"
  else
    fail "No sha256sum or shasum found for checksum verification."
  fi
  [ "$ACTUAL_SHA256" = "$EXPECTED_SHA256" ] || fail "Checksum mismatch for $PACKAGE. Expected $EXPECTED_SHA256, got $ACTUAL_SHA256."
  printf 'Verified SHA256: %s\n' "$ACTUAL_SHA256"
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
printf '  AGENTIX_PACKAGE=@nerdyy/agentix@2.1.8 curl -fsSL https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.sh | sh\n'
printf 'Use AGENTIX_VERSION to install a verified GitHub release tarball:\n'
printf '  AGENTIX_VERSION=2.1.0 curl -fsSL https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.sh | sh\n'
