#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
LAUNCHER="$REPO_ROOT/opencode/open-design-mcp.sh"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[ -x "$LAUNCHER" ] || fail "OpenDesign launcher is missing or not executable: $LAUNCHER"

if cli=$(sh "$LAUNCHER" --resolve-cli); then
  printf 'Using existing OpenDesign CLI: %s\n' "$cli"
else
  fail "Install the supported OpenDesign CLI or desktop app, then set OPEN_DESIGN_CLI to its absolute CLI path and rerun this script. No software was downloaded."
fi

grep -Fq '"codegraph"' "$REPO_ROOT/opencode/opencode.jsonc" \
  || fail "the canonical CodeGraph MCP entry is missing"
grep -Fq '"open-design"' "$REPO_ROOT/opencode/opencode.jsonc" \
  || fail "the canonical OpenDesign MCP entry is missing"

printf '%s\n' "OpenDesign MCP launcher and canonical configuration are ready."
printf '%s\n' "This setup does not install software or start the OpenDesign UI/daemon."
printf '%s\n' "Run scripts/install.sh to expose the repository-owned config, skill, and launcher to OpenCode."
printf '%s\n' "Run scripts/check-open-design.sh to verify headless MCP connectivity and resource reads."
