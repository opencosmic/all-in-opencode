#!/usr/bin/env sh

set -eu

PLUGIN_COMMIT="6cd5d12363a6cb49020b44325007c6154ea62cba"
PLUGIN_SHA256="0ac44613233beb66c91e10af8187c61664b3a358447c9d5fa86e3e70e7ca446f"
CONFIG_DIR=${OPENCODE_CONFIG_DIR:-"$HOME/.config/opencode"}
CONFIG_PATH="$CONFIG_DIR/tui.json"
PLUGIN_PATH="$CONFIG_DIR/tui-plugins/cache-stats.tsx"
ready=1

shasum_status="available"
if ! command -v shasum >/dev/null 2>&1; then
  shasum_status="not available (required to verify SHA-256)"
  ready=0
fi

config_status="missing ($CONFIG_PATH)"
if [ -f "$CONFIG_PATH" ] && grep -Fq '"./tui-plugins/cache-stats.tsx"' "$CONFIG_PATH"; then
  config_status="registered ($CONFIG_PATH)"
else
  ready=0
fi

plugin_status="missing ($PLUGIN_PATH)"
if [ -f "$PLUGIN_PATH" ]; then
  if [ "$shasum_status" != "available" ]; then
    plugin_status="cannot verify ($PLUGIN_PATH; shasum is not available)"
  else
    installed_sha256=$(shasum -a 256 "$PLUGIN_PATH" | awk '{print $1}')
    if [ "$installed_sha256" = "$PLUGIN_SHA256" ]; then
      plugin_status="installed at pinned upstream commit $PLUGIN_COMMIT ($PLUGIN_PATH)"
    else
      plugin_status="hash mismatch ($PLUGIN_PATH; got $installed_sha256)"
      ready=0
    fi
  fi
else
  ready=0
fi

opencode_status="not found"
if opencode_path=$(command -v opencode 2>/dev/null); then
  opencode_status="available ($opencode_path)"
else
  ready=0
fi

printf 'OpenCode TUI config: %s\n' "$config_status"
printf 'cache-stats plugin: %s\n' "$plugin_status"
printf 'SHA-256 verifier: %s\n' "$shasum_status"
printf 'OpenCode executable: %s\n' "$opencode_status"

if [ "$ready" -eq 1 ]; then
  printf '%s\n' "cache-stats status: READY"
else
  printf '%s\n' "cache-stats status: NOT READY (run scripts/install.sh and scripts/setup-cache-stats.sh)"
  exit 1
fi
