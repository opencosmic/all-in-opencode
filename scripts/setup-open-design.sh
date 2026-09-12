#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
LAUNCHER="$REPO_ROOT/opencode/open-design-mcp.sh"
SPEC_WRITER="$SCRIPT_DIR/lib/write-open-design-spec.mjs"
SPEC_PATH=${OPEN_DESIGN_MCP_SPEC:-"$HOME/.config/opencode/open-design-mcp.json"}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[ -x "$LAUNCHER" ] || fail "OpenDesign launcher is missing or not executable: $LAUNCHER"
[ -f "$SPEC_WRITER" ] || fail "OpenDesign launch-spec helper is missing: $SPEC_WRITER"
command -v node >/dev/null 2>&1 || fail "Node.js is required to provision the OpenDesign launch spec"

if cli=$(sh "$LAUNCHER" --resolve-cli); then
  printf 'Using existing OpenDesign CLI: %s\n' "$cli"
else
  fail "Install the supported OpenDesign CLI or desktop app, then set OPEN_DESIGN_CLI to its absolute CLI path and rerun this script. No software was downloaded."
fi

grep -Fq '"codegraph"' "$REPO_ROOT/opencode/opencode.jsonc" \
  || fail "the canonical CodeGraph MCP entry is missing"
grep -Fq '"open-design"' "$REPO_ROOT/opencode/opencode.jsonc" \
  || fail "the canonical OpenDesign MCP entry is missing"

raw_spec=$(mktemp "${TMPDIR:-/tmp}/open-design-install.XXXXXX")
trap 'rm -f "$raw_spec"' EXIT HUP INT TERM
if [ -n "${OPEN_DESIGN_MCP_DAEMON_URL:-}" ]; then
  "$cli" mcp install opencode --print --json --daemon-url "$OPEN_DESIGN_MCP_DAEMON_URL" >"$raw_spec" \
    || fail "the supported OpenDesign CLI could not print its canonical MCP launch spec"
else
  "$cli" mcp install opencode --print --json >"$raw_spec" \
    || fail "the supported OpenDesign CLI could not print its canonical MCP launch spec"
fi
if [ -n "${OPEN_DESIGN_MCP_DAEMON_URL:-}" ] || [ -n "${OD_DAEMON_URL:-}" ]; then
  node "$SPEC_WRITER" --input "$raw_spec" --output "$SPEC_PATH" --fallback-cli "$cli" --allow-minimal-direct \
    || fail "the OpenDesign CLI returned an unsupported MCP launch spec"
else
  node "$SPEC_WRITER" --input "$raw_spec" --output "$SPEC_PATH" --fallback-cli "$cli" \
    || fail "the OpenDesign CLI returned an unsupported MCP launch spec"
fi

printf '%s\n' "OpenDesign MCP launcher and canonical configuration are ready."
printf '%s\n' "This setup does not install software or start the OpenDesign UI/daemon."
printf 'Machine-local launch metadata: %s\n' "$SPEC_PATH"
printf '%s\n' "Run scripts/install.sh to expose the repository-owned config, skill, and launcher to OpenCode."
printf '%s\n' "Run scripts/check-open-design.sh to verify headless MCP connectivity and resource reads."
