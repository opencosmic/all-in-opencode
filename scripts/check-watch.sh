#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SKILL_RESOLVER="$SCRIPT_DIR/lib/resolve-watch-skill.sh"

skill_status=missing
preflight_status="not checked"

if skill_dir=$(sh "$SKILL_RESOLVER"); then
  if [ -f "$skill_dir/scripts/watch.py" ] && [ -f "$skill_dir/scripts/setup.py" ]; then
    skill_status="present with bundled runtime ($skill_dir)"
    if command -v opencode >/dev/null 2>&1 &&
      discovered_skill=$(opencode debug skill 2>/dev/null | node -e '
        let input = ""
        process.stdin.on("data", (chunk) => { input += chunk })
        process.stdin.on("end", () => {
          const skill = JSON.parse(input).find((entry) => entry.name === "watch")
          if (!skill?.location) process.exit(1)
          process.stdout.write(skill.location)
        })
      ') &&
      [ "$discovered_skill" = "$skill_dir/SKILL.md" ]
    then
      skill_status="discoverable ($skill_dir)"
    fi
    if command -v python3 >/dev/null 2>&1; then
      preflight_status=$(python3 "$skill_dir/scripts/setup.py" --json 2>/dev/null | node -e '
        let input = ""
        process.stdin.on("data", (chunk) => { input += chunk })
        process.stdin.on("end", () => {
          try {
            const status = JSON.parse(input)
            process.stdout.write(`${status.status}; can_proceed=${status.can_proceed}`)
          } catch {
            process.exit(1)
          }
        })
      ' 2>/dev/null || printf '%s' "unavailable")
    fi
  else
    skill_status="incomplete ($skill_dir)"
  fi
fi

printf 'watch skill: %s\n' "$skill_status"
printf 'watch upstream preflight: %s\n' "$preflight_status"
