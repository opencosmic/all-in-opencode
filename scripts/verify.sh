#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
MANIFEST="$SCRIPT_DIR/links.tsv"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

check_hash() {
  relative_path=$1
  expected=$2
  actual=$(shasum -a 256 "$REPO_ROOT/$relative_path" | awk '{print $1}')
  [ "$actual" = "$expected" ] || fail "frozen hash mismatch: $relative_path"
  printf 'PASS hash %s\n' "$relative_path"
}

[ -f "$MANIFEST" ] || fail "link manifest is missing: $MANIFEST"

while IFS='|' read -r source_rel live_rel kind; do
  case "$source_rel" in ''|'#'*) continue ;; esac
  source_path="$REPO_ROOT/$source_rel"
  live_path="$HOME/$live_rel"
  [ -e "$source_path" ] || fail "repository source is missing: $source_path"
  [ -L "$live_path" ] || fail "live path is not a symlink: $live_path"
  [ -e "$live_path" ] || fail "live symlink is broken: $live_path"
  [ "$(readlink "$live_path")" = "$source_path" ] || fail "live symlink targets an unexpected source: $live_path"
  printf 'PASS link %s -> %s\n' "$live_path" "$source_path"
done < "$MANIFEST"

check_hash opencode/agents/planner.md 8eeabf09d6cf2e3faa2265d4e8ad77626c15040183b823006b75eca902027346
check_hash opencode/agents/plan-reviewer.md 80a33ef1dd75e7a43586182f524e7f8d63887efc56a668ee324f39f97a7c3281
check_hash opencode/agents/executor.md 363f98e52f431ad207027f4778ccf6084bc52245ec8e5107aae0ba9e89980f2e
check_hash opencode/agents/reviewer.md 82ff6503ed4c6fcc2d312f3c8cd6b0c128c8a3220cf2713ea9d7fb35f0ae1c6a

printf 'PASS repository root %s\n' "$REPO_ROOT"
