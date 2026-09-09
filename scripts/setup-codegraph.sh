#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
PROJECT_PATH=${1:-$REPO_ROOT}
CODEGRAPH_VERSION=${CODEGRAPH_VERSION:-1.5.0}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

if ! command -v codegraph >/dev/null 2>&1; then
  command -v curl >/dev/null 2>&1 || fail "curl is required to install CodeGraph"
  printf 'Installing public CodeGraph %s...\n' "$CODEGRAPH_VERSION"
  curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh \
    | CODEGRAPH_VERSION="$CODEGRAPH_VERSION" sh
fi

command -v codegraph >/dev/null 2>&1 || fail "codegraph is not on PATH; add ~/.local/bin and retry"
[ -d "$PROJECT_PATH" ] || fail "project directory does not exist: $PROJECT_PATH"

if codegraph status --json "$PROJECT_PATH" 2>/dev/null | grep -q '"initialized"[[:space:]]*:[[:space:]]*true'; then
  printf 'Using existing CodeGraph index: %s\n' "$PROJECT_PATH"
else
  printf 'Creating CodeGraph index: %s\n' "$PROJECT_PATH"
  codegraph init "$PROJECT_PATH"
fi

"$SCRIPT_DIR/check-codegraph.sh" "$PROJECT_PATH"
