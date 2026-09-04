#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SKILL_RESOLVER="$SCRIPT_DIR/lib/resolve-ego-browser-skill.sh"

runtime_status=missing
skill_status=missing
runtime_ready=0
skill_ready=0

if runtime_path=$(command -v ego-browser 2>/dev/null); then
  runtime_status="present but not provisioned ($runtime_path)"
  probe_marker="ego-browser-health-$PPID-$$"
  if runtime_output=$(printf "console.log('%s')\n" "$probe_marker" | "$runtime_path" nodejs 2>&1) &&
    printf '%s\n' "$runtime_output" | grep -Fq "$probe_marker"
  then
    runtime_status="available and provisioned ($runtime_path)"
    runtime_ready=1
  fi
fi

if skill_dir=$(sh "$SKILL_RESOLVER"); then
  skill_status="present but not confirmed by OpenCode ($skill_dir)"
  if command -v opencode >/dev/null 2>&1 &&
    discovered_skill=$(opencode debug skill 2>/dev/null | node -e '
      let input = ""
      process.stdin.on("data", (chunk) => { input += chunk })
      process.stdin.on("end", () => {
        const skill = JSON.parse(input).find((entry) => entry.name === "ego-browser")
        if (!skill?.location) process.exit(1)
        process.stdout.write(skill.location)
      })
    ') &&
    [ "$discovered_skill" = "$skill_dir/SKILL.md" ]
  then
    skill_status="discoverable ($skill_dir)"
    skill_ready=1
  fi
fi

printf 'ego-browser runtime: %s\n' "$runtime_status"
printf 'ego-browser skill: %s\n' "$skill_status"

if [ "$runtime_ready" -ne 1 ] || [ "$skill_ready" -ne 1 ]; then
  printf '%s\n' "optional runtime status: NOT READY (authored configuration remains valid)"
else
  printf '%s\n' "optional runtime status: READY"
fi
