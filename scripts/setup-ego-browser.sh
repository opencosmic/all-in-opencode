#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SKILL_DIR="$HOME/.config/opencode/skills/ego-browser"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

command -v npx >/dev/null 2>&1 || fail "npx is required to install the official ego-browser skill"
[ "$(uname -s)" = Darwin ] || fail "the official ego lite installer currently supports macOS only"

printf '%s\n' "Installing the official ego-browser skill for OpenCode..."
npx --yes skills add citrolabs/ego-lite --global --agent opencode --skill ego-browser -y

[ -f "$SKILL_DIR/SKILL.md" ] || fail "the official skill was not installed at $SKILL_DIR"
[ -f "$SKILL_DIR/scripts/install.sh" ] || fail "the official ego lite installer is missing from $SKILL_DIR"

printf '%s\n' "Running the official ego lite application installer..."
sh "$SKILL_DIR/scripts/install.sh"

printf '%s\n' "If the app opened onboarding, complete it in the GUI, then rerun:"
printf '  %s/check-ego-browser.sh\n' "$SCRIPT_DIR"
"$SCRIPT_DIR/check-ego-browser.sh"
