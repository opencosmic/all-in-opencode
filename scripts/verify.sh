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
for phase_agent in director creator editor; do
  [ -f "$REPO_ROOT/opencode/agents/$phase_agent.md" ] || fail "dedicated $phase_agent agent is missing"
done
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

check_hash opencode/agents/planner.md 8fed9f201932b9cb3599e36f33919d759752a2637b40e75e1af5e6c19af5e438
check_hash opencode/agents/plan-reviewer.md d78071c4ba16b847d76489d43f20213cd12ed87e08ac8b110dff1fef86a6963c
check_hash opencode/agents/executor.md 1e1109a36beac4fc7a85f2a70f1b4c8dcacbce18b33175bcbeb0bcf91719a363
check_hash opencode/agents/reviewer.md 7a4199f4f064945c0222cb89faf11cc20b97008f792c02104e5e30b6f584851e

"$SCRIPT_DIR/check-codegraph.sh" "$REPO_ROOT"

printf 'PASS repository root %s\n' "$REPO_ROOT"
