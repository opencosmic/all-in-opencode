#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
LAUNCHER="$REPO_ROOT/opencode/open-design-mcp.sh"
CONFIG="$REPO_ROOT/opencode/opencode.jsonc"
PROBE="$SCRIPT_DIR/lib/check-open-design-mcp.mjs"
SPEC_WRITER="$SCRIPT_DIR/lib/write-open-design-spec.mjs"

ready=1

if [ -x "$LAUNCHER" ]; then
  launcher_status="ready ($LAUNCHER)"
else
  launcher_status="missing or not executable ($LAUNCHER)"
  ready=0
fi

config_status="invalid"
if [ -f "$CONFIG" ] \
  && grep -Fq '"codegraph"' "$CONFIG" \
  && grep -Fq '"open-design"' "$CONFIG" \
  && grep -Fq '"open_design_*": "deny"' "$CONFIG" \
  && ! grep -Eq '/(Users|Applications)/' "$CONFIG"
then
  config_status="valid (CodeGraph preserved; OpenDesign uses the repository launcher)"
else
  ready=0
fi

cli=""
if [ -x "$LAUNCHER" ] && cli=$(/bin/sh "$LAUNCHER" --resolve-cli 2>/dev/null); then
  cli_status="detected ($cli)"
else
  cli_status="not currently discoverable (informational; setup may need OPEN_DESIGN_CLI)"
fi

spec_path=${OPEN_DESIGN_MCP_SPEC:-"$HOME/.config/opencode/open-design-mcp.json"}
spec_ready=0
if [ -f "$spec_path" ] && command -v node >/dev/null 2>&1 \
  && node "$SPEC_WRITER" --input "$spec_path" --check >/dev/null 2>&1
then
  spec_status="provisioned ($spec_path)"
  spec_ready=1
else
  spec_status="missing or invalid (run scripts/setup-open-design.sh)"
  ready=0
fi

live_config="$HOME/.config/opencode/opencode.jsonc"
if [ -L "$live_config" ] && [ "$(readlink "$live_config")" = "$CONFIG" ]; then
  config_link_status="installed ($live_config)"
else
  config_link_status="not installed (run scripts/install.sh)"
  ready=0
fi

live_launcher="$HOME/.config/opencode/open-design-mcp.sh"
if [ -L "$live_launcher" ] && [ "$(readlink "$live_launcher")" = "$LAUNCHER" ]; then
  launcher_link_status="installed ($live_launcher)"
else
  launcher_link_status="not installed (run scripts/install.sh)"
  ready=0
fi

mcp_status="not checked"
if [ "$spec_ready" -eq 1 ]; then
  if ! command -v node >/dev/null 2>&1; then
    mcp_status="not checked (Node.js is unavailable)"
    ready=0
  else
    probe_output=$(mktemp "${TMPDIR:-/tmp}/open-design-mcp-check.XXXXXX")
    if [ -n "${OPEN_DESIGN_MCP_DAEMON_URL:-}" ]; then
      if node "$PROBE" --launcher "$LAUNCHER" --daemon-url "$OPEN_DESIGN_MCP_DAEMON_URL" >"$probe_output" 2>&1; then
        mcp_status="ready"
      else
        mcp_status="not ready"
        ready=0
      fi
    else
      if node "$PROBE" --launcher "$LAUNCHER" >"$probe_output" 2>&1; then
        mcp_status="ready"
      else
        mcp_status="not ready"
        ready=0
      fi
    fi
    sed -n '1,20p' "$probe_output"
    rm -f "$probe_output"
  fi
else
  ready=0
fi

printf 'OpenDesign launcher: %s\n' "$launcher_status"
printf 'OpenDesign setup CLI: %s\n' "$cli_status"
printf 'OpenDesign launch spec: %s\n' "$spec_status"
printf 'Canonical MCP config: %s\n' "$config_status"
printf 'OpenCode config link: %s\n' "$config_link_status"
printf 'OpenDesign launcher link: %s\n' "$launcher_link_status"
printf 'OpenDesign MCP probe: %s\n' "$mcp_status"

if [ "$ready" -eq 1 ]; then
  printf '%s\n' "OpenDesign status: READY"
else
  printf '%s\n' "OpenDesign status: NOT READY (install the CLI, run scripts/install.sh, or start the supported headless daemon as indicated above)"
  exit 1
fi
