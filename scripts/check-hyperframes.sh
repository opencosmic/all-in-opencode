#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SKILL_RESOLVER="$SCRIPT_DIR/lib/resolve-hyperframes-skill.sh"

ready=1

node_status="missing"
if node_path=$(command -v node 2>/dev/null); then
  node_version=$(node -p 'process.versions.node' 2>/dev/null || printf '%s' "unknown")
  node_major=${node_version%%.*}
  case "$node_major" in
    ''|*[!0-9]*) node_status="unreadable ($node_path)"; ready=0 ;;
    *)
      if [ "$node_major" -ge 22 ]; then
        node_status="ready ($node_version at $node_path)"
      else
        node_status="too old ($node_version at $node_path; requires Node.js 22+)"
        ready=0
      fi
      ;;
  esac
else
  ready=0
fi

npx_status="missing"
if npx_path=$(command -v npx 2>/dev/null); then
  npx_status="ready ($npx_path)"
else
  ready=0
fi

ffmpeg_status="missing"
if ffmpeg_path=$(command -v ffmpeg 2>/dev/null); then
  ffmpeg_status="ready ($ffmpeg_path)"
else
  ready=0
fi

ffprobe_status="missing"
if ffprobe_path=$(command -v ffprobe 2>/dev/null); then
  ffprobe_status="ready ($ffprobe_path)"
else
  ready=0
fi

skill_dir=""
entry_status="missing"
if skill_dir=$(sh "$SKILL_RESOLVER"); then
  if [ -f "$skill_dir/SKILL.md" ]; then
    entry_status="present ($skill_dir)"
  else
    entry_status="incomplete ($skill_dir)"
    ready=0
  fi
else
  ready=0
fi

discovery_status="not checked"
if [ -n "$skill_dir" ] && command -v opencode >/dev/null 2>&1; then
  discovery_file=$(mktemp "${TMPDIR:-/tmp}/hyperframes-opencode-skill.XXXXXX")
  if opencode debug skill >"$discovery_file" 2>/dev/null &&
    discovered_skill=$(node -e '
      const fs = require("node:fs")
      const input = fs.readFileSync(process.argv[1], "utf8")
      const skill = JSON.parse(input).find((entry) => entry.name === "hyperframes")
      if (!skill?.location) process.exit(1)
      process.stdout.write(skill.location)
    ' "$discovery_file") &&
    [ "$discovered_skill" = "$skill_dir/SKILL.md" ]; then
    discovery_status="discoverable ($skill_dir)"
  else
    discovery_status="not discoverable ($skill_dir)"
    ready=0
  fi
  rm "$discovery_file"
else
  discovery_status="not checked (opencode or entry skill unavailable)"
  ready=0
fi

skill_health="not checked"
if [ "$npx_status" != "missing" ] && command -v node >/dev/null 2>&1; then
  skill_check_file=$(mktemp "${TMPDIR:-/tmp}/hyperframes-skill-check.XXXXXX")
  if npx --yes hyperframes skills check --json >"$skill_check_file" 2>/dev/null; then
    skill_check_exit=0
  else
    skill_check_exit=$?
  fi
  skill_check_output=$(cat "$skill_check_file" 2>/dev/null || true)
  rm "$skill_check_file"
  if skill_check_summary=$(printf '%s\n' "$skill_check_output" | node -e '
    let input = ""
    process.stdin.on("data", (chunk) => { input += chunk })
    process.stdin.on("end", () => {
      try {
        const start = input.indexOf("{")
        if (start < 0) process.exit(1)
        const payload = JSON.parse(input.slice(start))
        const entry = payload.skills?.find((skill) => skill.name === "hyperframes")
        const summary = payload.summary ?? {}
        if (
          !entry ||
          entry.status === "missing" ||
          entry.status === "outdated" ||
          Number(summary.coreMissing ?? 1) > 0 ||
          payload.updateAvailable === true
        ) {
          process.exit(1)
        }
        process.stdout.write(`entry=${entry.status}; core_missing=${summary.coreMissing ?? "unknown"}; missing=${summary.missing ?? "unknown"}`)
      } catch {
        process.exit(1)
      }
    })
  '); then
    if [ "$skill_check_exit" -eq 0 ]; then
      skill_health="healthy ($skill_check_summary)"
    else
      skill_health="stale or incomplete ($skill_check_summary)"
      ready=0
    fi
  else
    skill_health="failed (npx hyperframes skills check --json; exit $skill_check_exit)"
    ready=0
  fi
else
  skill_health="not checked (npx or Node.js unavailable)"
  ready=0
fi

printf 'Node.js: %s\n' "$node_status"
printf 'npx: %s\n' "$npx_status"
printf 'FFmpeg: %s\n' "$ffmpeg_status"
printf 'ffprobe: %s\n' "$ffprobe_status"
printf 'HyperFrames entry skill: %s\n' "$entry_status"
printf 'OpenCode discovery: %s\n' "$discovery_status"
printf 'HyperFrames skills check: %s\n' "$skill_health"

if [ "$ready" -eq 1 ]; then
  printf '%s\n' "HyperFrames status: READY"
else
  printf '%s\n' "HyperFrames status: NOT READY (run scripts/setup-hyperframes.sh for the explicit install/update boundary)"
  exit 1
fi
