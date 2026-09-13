#!/usr/bin/env sh

set -eu

PLUGIN_COMMIT="6cd5d12363a6cb49020b44325007c6154ea62cba"
PLUGIN_SHA256="0ac44613233beb66c91e10af8187c61664b3a358447c9d5fa86e3e70e7ca446f"
PLUGIN_URL="https://raw.githubusercontent.com/nmdra/opencode-cache-stats/$PLUGIN_COMMIT/tui-plugins/cache-stats.tsx"
CONFIG_DIR=${OPENCODE_CONFIG_DIR:-"$HOME/.config/opencode"}
PLUGIN_DIR="$CONFIG_DIR/tui-plugins"
PLUGIN_PATH="$PLUGIN_DIR/cache-stats.tsx"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required to install the upstream cache-stats TUI plugin"
command -v shasum >/dev/null 2>&1 || fail "shasum is required to verify the upstream cache-stats TUI plugin"

if [ -e "$CONFIG_DIR" ] && [ ! -d "$CONFIG_DIR" ]; then
  fail "OpenCode config path is not a directory: $CONFIG_DIR"
fi
if [ -e "$PLUGIN_DIR" ] && [ ! -d "$PLUGIN_DIR" ]; then
  fail "OpenCode TUI plugin path is not a directory: $PLUGIN_DIR"
fi

cache_stats_tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/opencode-cache-stats.XXXXXX")
trap 'rm -rf "$cache_stats_tmp_dir"' EXIT HUP INT TERM
cache_stats_tmp_file="$cache_stats_tmp_dir/cache-stats.tsx"

printf 'Downloading upstream cache-stats TUI plugin at %s...\n' "$PLUGIN_COMMIT"
curl --fail --location --silent --show-error "$PLUGIN_URL" --output "$cache_stats_tmp_file"
actual_sha256=$(shasum -a 256 "$cache_stats_tmp_file" | awk '{print $1}')
[ "$actual_sha256" = "$PLUGIN_SHA256" ] ||
  fail "downloaded cache-stats plugin failed SHA-256 verification (expected $PLUGIN_SHA256, got $actual_sha256)"

if [ -e "$PLUGIN_PATH" ] || [ -L "$PLUGIN_PATH" ]; then
  [ -f "$PLUGIN_PATH" ] || fail "refusing to replace non-file cache-stats plugin path: $PLUGIN_PATH"
  installed_sha256=$(shasum -a 256 "$PLUGIN_PATH" | awk '{print $1}')
  [ "$installed_sha256" = "$PLUGIN_SHA256" ] ||
    fail "a different cache-stats plugin already exists at $PLUGIN_PATH; preserving it"
  printf 'cache-stats is already installed at %s\n' "$PLUGIN_PATH"
  exit 0
fi

mkdir -p "$PLUGIN_DIR"
chmod 0644 "$cache_stats_tmp_file"
mv "$cache_stats_tmp_file" "$PLUGIN_PATH"
printf 'Installed cache-stats at %s\n' "$PLUGIN_PATH"
printf '%s\n' "Restart OpenCode, then run /cache-stats inside a session."
