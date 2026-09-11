#!/usr/bin/env sh

set -eu

# This is the upstream probe exposed by `od mcp install`. It distinguishes the
# OpenDesign CLI from macOS/Linux's unrelated `/usr/bin/od` utility.
OPEN_DESIGN_PROBE_TOKEN='open-design-cli:mcp-install:v1'

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

is_open_design_cli() {
  candidate=$1
  [ -x "$candidate" ] || return 1
  probe=$(
    "$candidate" mcp install --open-design-cli-probe 2>/dev/null
  ) || return 1
  [ "$probe" = "$OPEN_DESIGN_PROBE_TOKEN" ]
}

resolve_cli() {
  if [ -n "${OPEN_DESIGN_CLI:-}" ]; then
    case "$OPEN_DESIGN_CLI" in
      /*) ;;
      *) fail "OPEN_DESIGN_CLI must be an absolute path to the OpenDesign CLI" ;;
    esac
    is_open_design_cli "$OPEN_DESIGN_CLI" ||
      fail "OPEN_DESIGN_CLI is not a supported OpenDesign CLI: $OPEN_DESIGN_CLI"
    printf '%s\n' "$OPEN_DESIGN_CLI"
    return 0
  fi

  # Keep spaces and wildcard characters in PATH entries literal, and skip
  # relative/empty entries so a project-local executable cannot become an
  # implicit MCP trust source.
  path_list=${PATH:-}
  while [ -n "$path_list" ]; do
    case "$path_list" in
      *:*)
        directory=${path_list%%:*}
        path_list=${path_list#*:}
        ;;
      *)
        directory=$path_list
        path_list=""
        ;;
    esac
    case "$directory" in
      /*) ;;
      *) continue
        ;;
    esac
    candidate="$directory/od"
    if is_open_design_cli "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  fail "OpenDesign CLI not found. Install the supported OpenDesign CLI or app, then set OPEN_DESIGN_CLI to its absolute path and rerun scripts/setup-open-design.sh. The system /usr/bin/od is not OpenDesign."
}

if [ "${1:-}" = "--resolve-cli" ]; then
  resolve_cli
  exit 0
fi

cli=$(resolve_cli)
if [ -n "${OPEN_DESIGN_MCP_DAEMON_URL:-}" ]; then
  exec "$cli" mcp --daemon-url "$OPEN_DESIGN_MCP_DAEMON_URL" "$@"
fi
exec "$cli" mcp "$@"
