#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
MANIFEST="$SCRIPT_DIR/links.tsv"
CONFIG_DIR="$HOME/.config/opencode"
LEGACY_CATEGORY_CONFIG="$CONFIG_DIR/categories.json"
AIO_CONFIG="$CONFIG_DIR/aio.json"

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

if [ -e "$LEGACY_CATEGORY_CONFIG" ] || [ -L "$LEGACY_CATEGORY_CONFIG" ]; then
  fail "categories.json is no longer supported at $LEGACY_CATEGORY_CONFIG. Migrate its values to $AIO_CONFIG under \"categories\", then rename the legacy file and rerun verification."
fi

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

[ -d "$CONFIG_DIR/agents" ] || fail "user-owned agents directory is missing"
[ ! -L "$CONFIG_DIR/agents" ] || fail "agents directory is still a symlink"

[ ! -e "$REPO_ROOT/omo/omo.jsonc" ] || fail "obsolete OMO configuration still exists"
[ ! -e "$REPO_ROOT/opencode/commands/omo.md" ] || fail "obsolete /omo command still exists"
[ -f "$REPO_ROOT/opencode/agents/browser.md" ] || fail "dedicated Browser agent is missing"
[ -f "$REPO_ROOT/opencode/commands/browser.md" ] || fail "dedicated /browser command is missing"
[ -f "$REPO_ROOT/opencode/agents/producer.md" ] || fail "dedicated Producer agent is missing"
[ ! -e "$REPO_ROOT/opencode/agents/video.md" ] || fail "retired Video agent definition still exists"
[ -f "$REPO_ROOT/opencode/commands/video.md" ] || fail "dedicated /video command is missing"
[ -f "$REPO_ROOT/opencode/commands/film.md" ] || fail "dedicated /film command is missing"
[ -f "$REPO_ROOT/opencode/skills/film-production/SKILL.md" ] || fail "film-production skill is missing"
[ -f "$REPO_ROOT/opencode/agents/searcher.md" ] || fail "dedicated Searcher agent is missing"
[ -f "$REPO_ROOT/opencode/commands/search.md" ] || fail "dedicated /search command is missing"
[ -f "$REPO_ROOT/opencode/agents/professor.md" ] || fail "dedicated Professor agent is missing"
[ -f "$REPO_ROOT/opencode/commands/research.md" ] || fail "dedicated /research command is missing"
[ -f "$REPO_ROOT/opencode/plugins/professor-runtime.js" ] || fail "Professor runtime plugin is missing"
[ -f "$REPO_ROOT/opencode/agents/blender.md" ] || fail "dedicated Blender agent is missing"
[ -f "$REPO_ROOT/opencode/commands/blender.md" ] || fail "dedicated /blender command is missing"
[ -f "$REPO_ROOT/scripts/setup-blender-mcp.sh" ] || fail "Blender MCP setup script is missing"
[ -f "$REPO_ROOT/scripts/check-blender-mcp.sh" ] || fail "Blender MCP check script is missing"
[ -f "$REPO_ROOT/opencode/open-design-mcp.sh" ] || fail "OpenDesign MCP launcher is missing"
[ -f "$REPO_ROOT/opencode/skills/open-design/SKILL.md" ] || fail "OpenDesign skill is missing"
[ -f "$REPO_ROOT/scripts/setup-open-design.sh" ] || fail "OpenDesign setup script is missing"
[ -f "$REPO_ROOT/scripts/check-open-design.sh" ] || fail "OpenDesign check script is missing"
[ -f "$REPO_ROOT/scripts/setup-cache-stats.sh" ] || fail "cache-stats setup script is missing"
[ -f "$REPO_ROOT/scripts/check-cache-stats.sh" ] || fail "cache-stats check script is missing"
grep -Fq '"open-design"' "$REPO_ROOT/opencode/opencode.jsonc" || fail "OpenDesign MCP configuration is missing"
grep -Fq '"open_design_*": "deny"' "$REPO_ROOT/opencode/opencode.jsonc" || fail "OpenDesign raw-tool deny ceiling is missing"
grep -Fq '"./tui-plugins/cache-stats.tsx"' "$REPO_ROOT/opencode/tui.json" || fail "cache-stats TUI plugin registration is missing"
[ ! -e "$REPO_ROOT/opencode/commands/ego.md" ] || fail "obsolete /ego command still exists"
if [ -L "$HOME/.omo/omo.jsonc" ] && [ "$(readlink "$HOME/.omo/omo.jsonc")" = "$REPO_ROOT/omo/omo.jsonc" ]; then
  fail "obsolete repository-managed OMO symlink still exists"
fi

check_hash opencode/agents/planner.md 804c4dcd206b3074119c8c3fc5f4e1db7ad0093b9e214d800a46b8443a0c927b
check_hash opencode/agents/plan-reviewer.md aea1dc13ea55a7f6c59233fd516215e7aff8bcf9fd6bd3120b3de2e01d577829
check_hash opencode/agents/executor.md 360204cf3693f60a489026186251344c78d8f33fc4d11ac96d46c17ea864f9b8
check_hash opencode/agents/reviewer.md 243023cbcb1e3e670ff0ca4df9207a19f587527441651f15c5cbca64bc66d641

"$SCRIPT_DIR/check-codegraph.sh" "$REPO_ROOT"

printf 'PASS repository root %s\n' "$REPO_ROOT"
