#!/usr/bin/env sh

set -eu

[ -n "${HOME:-}" ] || exit 1

# Match the global skill locations already supported by SkillResolver, from
# highest to lowest OpenCode precedence.
for candidate in \
  "$HOME/.config/opencode/skills/watch" \
  "$HOME/.config/opencode/skill/watch" \
  "$HOME/.agents/skills/watch" \
  "$HOME/.claude/skills/watch"
do
  if [ -f "$candidate/SKILL.md" ]; then
    printf '%s\n' "$candidate"
    exit 0
  fi
done

exit 1
