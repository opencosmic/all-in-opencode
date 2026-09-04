#!/usr/bin/env sh

set -eu

[ -n "${HOME:-}" ] || exit 1

# Match OpenCode's global skill precedence from highest to lowest.
for candidate in \
  "$HOME/.config/opencode/skills/ego-browser" \
  "$HOME/.agents/skills/ego-browser" \
  "$HOME/.claude/skills/ego-browser"
do
  if [ -f "$candidate/SKILL.md" ]; then
    printf '%s\n' "$candidate"
    exit 0
  fi
done

exit 1
