#!/usr/bin/env sh
set -eu

usage() {
  printf '%s\n' "Usage: $0 --candidate /absolute/path/to/oh-my-openagent"
}

candidate=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --candidate) candidate=${2-}; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 64 ;;
  esac
done

[ -n "$candidate" ] || { usage >&2; exit 64; }
[ -d "$candidate/.git" ] || [ -f "$candidate/.git" ] || { printf '%s\n' "REJECT: candidate is not a Git worktree" >&2; exit 2; }
[ -f "$candidate/package.json" ] || { printf '%s\n' "REJECT: candidate package.json is missing" >&2; exit 2; }
[ -f "$candidate/dist/index.js" ] || { printf '%s\n' "REJECT: candidate dist/index.js is missing; build it first" >&2; exit 2; }

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
baseline="$root/docs/reference/omo-runtime-baseline.json"
[ -f "$baseline" ] || { printf '%s\n' "REJECT: runtime baseline is missing" >&2; exit 2; }

status=$(git -C "$candidate" status --short)
[ -z "$status" ] || { printf '%s\n' "REJECT: candidate has uncommitted changes" >&2; exit 2; }
version=$(node -p "require(process.argv[1]).version" "$candidate/package.json")
commit=$(git -C "$candidate" rev-parse HEAD)
printf 'OMO candidate: %s\ncommit: %s\n' "$version" "$commit"

node --test "$root/opencode/tests/worktree-isolation-probe.test.js"
probe=$(node "$root/scripts/probes/worktree-isolation.mjs" --omo-package-root "$candidate")
printf '%s\n' "$probe"

if ! printf '%s' "$probe" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);const n=p.mechanism.normalTask;process.exit(n.delegateTaskAcceptsCwd&&n.launchInputAcceptsCwd&&n.syncInheritsParent&&n.backgroundInheritsParent?0:1)})'
then
  printf '%s\n' "RESULT: REJECT — CAP-01/CAP-02/CAP-08 source gate failed. Production unchanged." >&2
  exit 2
fi

printf '%s\n' "STATIC_RESULT: PASS"
printf '%s\n' "RUNTIME_RESULT: REQUIRED — run the pinned runtime probes and Executor lane E2E before promotion."
printf '%s\n' "RESULT: NOT_SAFE_TO_PROMOTE_YET"
