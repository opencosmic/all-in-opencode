#!/usr/bin/env sh

set -eu

[ -n "${HOME:-}" ] || exit 1

# Match OpenCode's supported global skill locations from highest to lowest
# precedence. HyperFrames' official CLI currently links into .agents and
# .claude, while OpenCode also supports its plural config-local global directory.
for candidate in \
  "$HOME/.config/opencode/skills/hyperframes" \
  "$HOME/.agents/skills/hyperframes" \
  "$HOME/.claude/skills/hyperframes"
do
  if [ -f "$candidate/SKILL.md" ]; then
    printf '%s\n' "$candidate"
    exit 0
  fi
done

exit 1
