#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
CONFIG="$REPO_ROOT/opencode/opencode.jsonc"

fail() {
  printf 'NOT READY: %s\n' "$1" >&2
  exit 1
}

command -v uv >/dev/null 2>&1 || fail "uv is not on PATH"
command -v uvx >/dev/null 2>&1 || fail "uvx is not on PATH"
[ -f "$CONFIG" ] || fail "OpenCode configuration is missing: $CONFIG"

grep -q '"blender"' "$CONFIG" || fail "OpenCode Blender MCP entry is missing"
grep -q '"uvx"' "$CONFIG" || fail "Blender MCP command does not use uvx"
grep -q '"--python"' "$CONFIG" || fail "Blender MCP command is missing the Python selector"
grep -q '"3.11"' "$CONFIG" || fail "Blender MCP command is not pinned to Python 3.11"
grep -q '"blender-mcp"' "$CONFIG" || fail "Blender MCP package is missing from the command"
grep -q '"UV_PYTHON_PREFERENCE"[[:space:]]*:[[:space:]]*"only-managed"' "$CONFIG" \
  || fail "managed-Python preference is not configured"
grep -q '"BLENDER_HOST"[[:space:]]*:[[:space:]]*"localhost"' "$CONFIG" \
  || fail "Blender host is not restricted to localhost"
grep -q '"BLENDER_PORT"[[:space:]]*:[[:space:]]*"9876"' "$CONFIG" \
  || fail "Blender port is not configured as 9876"
grep -q '"BLENDER_MCP_SAFE_MODE"[[:space:]]*:[[:space:]]*"1"' "$CONFIG" \
  || fail "Blender MCP Safe Mode is not enabled"
grep -q '"DISABLE_TELEMETRY"[[:space:]]*:[[:space:]]*"true"' "$CONFIG" \
  || fail "Blender MCP telemetry is not disabled"

printf '%s\n' "uv: available"
printf '%s\n' "uvx: available"
printf '%s\n' "OpenCode Blender MCP: configured"
printf '%s\n' "Python: 3.11 with UV_PYTHON_PREFERENCE=only-managed"
printf '%s\n' "Socket policy: localhost:9876 only"
printf '%s\n' "Safe Mode: ON"
printf '%s\n' "Telemetry: OFF"
printf '%s\n' "Addon/server connectivity: not probed (open Blender and start the addon server)"
