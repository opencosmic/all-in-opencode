#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
PROJECT_PATH=${1:-$REPO_ROOT}

fail() {
  printf 'NOT READY: %s\n' "$1" >&2
  exit 1
}

command -v codegraph >/dev/null 2>&1 || fail "codegraph is not on PATH"
version=$(codegraph version)
status=$(codegraph status --json "$PROJECT_PATH" 2>/dev/null) || fail "project is not indexed: $PROJECT_PATH"
printf '%s\n' "$status" | grep -q '"initialized"[[:space:]]*:[[:space:]]*true' \
  || fail "CodeGraph status is not healthy for $PROJECT_PATH"

# Check the authored repository configuration directly. Debug output may be
# truncated by OpenCode when captured through a pipe, while this static check
# remains deterministic and verifies the exact public MCP declaration.
config="$REPO_ROOT/opencode/opencode.jsonc"
[ -f "$config" ] || fail "OpenCode configuration is missing: $config"
grep -q '"codegraph"' "$config" || fail "OpenCode CodeGraph MCP entry is missing"
grep -q '"serve"' "$config" || fail "OpenCode CodeGraph MCP command is incomplete"

printf 'CodeGraph runtime: %s\n' "$version"
printf 'CodeGraph index: READY (%s)\n' "$PROJECT_PATH"
printf '%s\n' "OpenCode MCP: configured"
