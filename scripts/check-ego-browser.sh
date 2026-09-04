#!/usr/bin/env sh
set -eu

runtime_status=missing
skill_status=missing
runtime_ready=0

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

if command -v opencode >/dev/null 2>&1 &&
  skill_path=$(opencode debug skill 2>/dev/null | node -e '
    let input = ""
    process.stdin.on("data", (chunk) => { input += chunk })
    process.stdin.on("end", () => {
      const skill = JSON.parse(input).find((entry) => entry.name === "ego-browser")
      if (!skill) process.exit(1)
      process.stdout.write(skill.location || "discoverable")
    })
  ')
then
  skill_status="discoverable ($skill_path)"
fi

printf 'ego-browser runtime: %s\n' "$runtime_status"
printf 'ego-browser skill: %s\n' "$skill_status"

if [ "$runtime_ready" -ne 1 ] || [ "$skill_status" = missing ]; then
  printf '%s\n' "optional runtime status: NOT READY (authored configuration remains valid)"
else
  printf '%s\n' "optional runtime status: READY"
fi
