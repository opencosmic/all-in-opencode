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

# The launcher is installed as an absolute symlink. Resolve that one hop so
# the repository-owned runner remains available when this file is invoked from
# ~/.config/opencode.
source_path=$0
if [ -L "$source_path" ]; then
  target=$(readlink "$source_path")
  case "$target" in
    /*) source_path=$target ;;
    *) source_path=$(dirname -- "$source_path")/$target ;;
  esac
fi
repo_root=$(CDPATH= cd -- "$(dirname -- "$source_path")/.." && pwd -P)
runner="$repo_root/scripts/lib/run-open-design-mcp.mjs"
spec_path=${OPEN_DESIGN_MCP_SPEC:-"$HOME/.config/opencode/open-design-mcp.json"}
[ -f "$runner" ] || fail "OpenDesign launcher runner is missing: $runner"
[ -f "$spec_path" ] || fail "OpenDesign launch spec is missing: $spec_path. Run scripts/setup-open-design.sh first."
[ -r "$spec_path" ] || fail "OpenDesign launch spec is not readable: $spec_path"
command -v node >/dev/null 2>&1 || fail "Node.js is required to execute the provisioned OpenDesign launch spec"

if [ -n "${OPEN_DESIGN_MCP_DAEMON_URL:-}" ]; then
  exec node "$runner" --spec "$spec_path" --fallback-cli "$cli" \
    --daemon-url "$OPEN_DESIGN_MCP_DAEMON_URL" -- "$@"
fi
exec node "$runner" --spec "$spec_path" --fallback-cli "$cli" -- "$@"
