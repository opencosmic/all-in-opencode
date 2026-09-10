#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SKILL_RESOLVER="$SCRIPT_DIR/lib/resolve-watch-skill.sh"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

if SKILL_DIR=$(sh "$SKILL_RESOLVER"); then
  printf 'Using existing watch skill: %s\n' "$SKILL_DIR"
else
  command -v npx >/dev/null 2>&1 || fail "npx is required to install the upstream watch skill"
  printf '%s\n' "Installing the upstream bradautomates/claude-video watch skill for OpenCode..."
  npx --yes skills add bradautomates/claude-video --global --agent opencode --skill watch -y
  SKILL_DIR=$(sh "$SKILL_RESOLVER") ||
    fail "the upstream watch skill was not found in any supported global OpenCode skill directory"
fi

[ -f "$SKILL_DIR/SKILL.md" ] || fail "the watch skill is missing SKILL.md at $SKILL_DIR"
[ -f "$SKILL_DIR/scripts/watch.py" ] || fail "the watch skill is missing scripts/watch.py at $SKILL_DIR"
[ -f "$SKILL_DIR/scripts/setup.py" ] || fail "the watch skill is missing scripts/setup.py at $SKILL_DIR"

printf '%s\n' "The upstream watch skill is installed with its bundled runtime."
printf 'Run the upstream preflight when needed: python3 %s/scripts/setup.py --json\n' "$SKILL_DIR"
printf '%s\n' "This project does not copy the skill or manage its optional Whisper keys."
