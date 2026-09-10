#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SKILL_RESOLVER="$SCRIPT_DIR/lib/resolve-hyperframes-skill.sh"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

command -v npx >/dev/null 2>&1 || fail "npx is required to install or update the upstream HyperFrames skills"
command -v node >/dev/null 2>&1 || fail "Node.js 22+ is required to install or update the upstream HyperFrames skills"
node_version=$(node -p 'process.versions.node' 2>/dev/null || printf '%s' "unknown")
node_major=${node_version%%.*}
case "$node_major" in
  ''|*[!0-9]*) fail "could not determine the installed Node.js version" ;;
  *) [ "$node_major" -ge 22 ] || fail "Node.js 22+ is required (found $node_version)" ;;
esac

printf '%s\n' "Refreshing the upstream HyperFrames core skill set and already-installed workflows for OpenCode..."
npx --yes hyperframes skills update
SKILL_DIR=$(sh "$SKILL_RESOLVER") ||
  fail "the upstream HyperFrames entry skill was not found after the official update"

[ -f "$SKILL_DIR/SKILL.md" ] || fail "the HyperFrames entry skill is missing SKILL.md at $SKILL_DIR"

printf '%s\n' "The upstream HyperFrames core skill set and already-installed workflows are installed outside this repository."
printf '%s\n' "Checking OpenCode discovery and local prerequisites..."
"$SCRIPT_DIR/check-hyperframes.sh"
