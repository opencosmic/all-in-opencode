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

[ ! -e "$REPO_ROOT/omo/omo.jsonc" ] || fail "obsolete OMO configuration still exists"
[ ! -e "$REPO_ROOT/opencode/commands/omo.md" ] || fail "obsolete /omo command still exists"
[ -f "$REPO_ROOT/opencode/agents/browser.md" ] || fail "dedicated Browser agent is missing"
[ -f "$REPO_ROOT/opencode/commands/browser.md" ] || fail "dedicated /browser command is missing"
[ ! -e "$REPO_ROOT/opencode/commands/ego.md" ] || fail "obsolete /ego command still exists"
if [ -L "$HOME/.omo/omo.jsonc" ] && [ "$(readlink "$HOME/.omo/omo.jsonc")" = "$REPO_ROOT/omo/omo.jsonc" ]; then
  fail "obsolete repository-managed OMO symlink still exists"
fi

check_hash opencode/agents/planner.md a69e5edaeeb44c82a9fb923717dba3e1c99f449acf62286e429c64cc5601b347
check_hash opencode/agents/plan-reviewer.md e60475766ed21222ec332aedeaf89a59072a6e88af6f6219117e25649f0dadd5
check_hash opencode/agents/executor.md cdc106283cbe8923ed0488ba3af46573d9baeafacc9f45d000bb6650d2ef2db0
check_hash opencode/agents/reviewer.md 895fd594ba5204a81ae8e615572006d02cf4059a4f055aaa09796e253da6df6a

"$SCRIPT_DIR/check-codegraph.sh" "$REPO_ROOT"

printf 'PASS repository root %s\n' "$REPO_ROOT"
