#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SKILL_RESOLVER="$SCRIPT_DIR/lib/resolve-ego-browser-skill.sh"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[ "$(uname -s)" = Darwin ] || fail "the official ego lite installer currently supports macOS only"

if SKILL_DIR=$(sh "$SKILL_RESOLVER"); then
  printf 'Using existing ego-browser skill: %s\n' "$SKILL_DIR"
else
  command -v npx >/dev/null 2>&1 || fail "npx is required to install the official ego-browser skill"
  printf '%s\n' "Installing the official ego-browser skill for OpenCode..."
  npx --yes skills add citrolabs/ego-lite --global --agent opencode --skill ego-browser -y
  SKILL_DIR=$(sh "$SKILL_RESOLVER") ||
    fail "the official skill was not found in any supported global OpenCode skill directory"
fi

[ -f "$SKILL_DIR/SKILL.md" ] || fail "the official skill was not installed at $SKILL_DIR"
[ -f "$SKILL_DIR/scripts/install.sh" ] || fail "the official ego lite installer is missing from $SKILL_DIR"

printf '%s\n' "Running the official ego lite application installer..."
sh "$SKILL_DIR/scripts/install.sh"

printf '%s\n' "If the app opened onboarding, complete it in the GUI, then rerun:"
printf '  %s/check-ego-browser.sh\n' "$SCRIPT_DIR"
"$SCRIPT_DIR/check-ego-browser.sh"
