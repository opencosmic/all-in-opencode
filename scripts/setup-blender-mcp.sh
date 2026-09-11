#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

command -v uv >/dev/null 2>&1 || fail "uv is required; install it with the official uv installer, then retry"
command -v uvx >/dev/null 2>&1 || fail "uvx is required; install it with the official uv installer, then retry"

printf '%s\n' "Installing the external Blender MCP addon with managed Python 3.11..."
UV_PYTHON_PREFERENCE=only-managed uvx --python 3.11 blender-mcp install-addon

printf '%s\n' "Blender MCP addon installation completed. Finish setup in Blender:"
printf '%s\n' "  1. Open Blender."
printf '%s\n' "  2. In Preferences → Add-ons, enable Interface: MCP for Blender if required."
printf '%s\n' "  3. Open the MCP for Blender panel in the 3D View sidebar."
printf '%s\n' "  4. Start the MCP server on localhost:9876."
printf '%s\n' "Run scripts/check-blender-mcp.sh for a read-only repository/runtime configuration check."
