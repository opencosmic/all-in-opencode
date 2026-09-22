#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
MANIFEST="$SCRIPT_DIR/links.tsv"
AGENTS_SOURCE="$REPO_ROOT/opencode/agents"
CONFIG_DIR="$HOME/.config/opencode"
AGENTS_DEST="$CONFIG_DIR/agents"
AGENTS_REL=".config/opencode/agents"
LEGACY_CATEGORY_CONFIG="$CONFIG_DIR/categories.json"
AIO_CONFIG="$CONFIG_DIR/aio.json"
# AIO_DATA_ROOT is canonical. Keep the legacy variable and directory discoverable
# so existing backup and migration state is not silently orphaned.
if [ -n "${AIO_DATA_ROOT:-}" ]; then
  DATA_ROOT=$AIO_DATA_ROOT
elif [ -n "${OPENCODE_WORKFLOW_DATA_ROOT:-}" ]; then
  DATA_ROOT=$OPENCODE_WORKFLOW_DATA_ROOT
elif [ -e "$HOME/Workspace/data/opencode-workflow" ] && [ ! -e "$HOME/Workspace/data/all-in-opencode" ]; then
  DATA_ROOT="$HOME/Workspace/data/opencode-workflow"
else
  DATA_ROOT="$HOME/Workspace/data/all-in-opencode"
fi
LEGACY_OMO_SOURCE="$REPO_ROOT/omo/omo.jsonc"
LEGACY_OMO_DEST="$HOME/.omo/omo.jsonc"
DRY_RUN=0
BACKUP_DIR=""
MIGRATING=0
AGENTS_MIGRATED=0
AGENTS_DIRECTORY_SYMLINK=0

usage() {
  printf '%s\n' "Usage: $0 [--dry-run] [--backup-dir PATH]"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

backup_path() {
  printf '%s/files/%s\n' "$BACKUP_DIR" "$1"
}

is_builtin_agent_name() {
  candidate=$1
  while IFS='|' read -r source_rel live_rel kind; do
    case "$source_rel" in ''|'#'*) continue ;; esac
    case "$source_rel" in
      opencode/agents/*)
        agent_rel=${source_rel#opencode/agents/}
        [ "$kind" = "file" ] && [ "$agent_rel" = "$candidate" ] && return 0
        ;;
    esac
  done < "$MANIFEST"
  return 1
}

same_source() {
  source_path=$1
  live_path=$2
  kind=$3
  if [ "$kind" = "directory" ]; then
    diff -rq -x .DS_Store "$source_path" "$live_path" >/dev/null 2>&1
  else
    cmp -s "$source_path" "$live_path"
  fi
}

rollback() {
  [ "$MIGRATING" -eq 1 ] || return 0
  printf '%s\n' "Migration failed; restoring modified live paths." >&2
  while IFS='|' read -r source_rel live_rel kind; do
    case "$source_rel" in ''|'#'*) continue ;; esac
    source_path="$REPO_ROOT/$source_rel"
    live_path="$HOME/$live_rel"
    saved_path=$(backup_path "$live_rel")
    if [ -e "$saved_path" ] || [ -L "$saved_path" ]; then
      if [ -L "$live_path" ] && [ "$(readlink "$live_path")" = "$source_path" ]; then
        rm "$live_path"
      fi
      mkdir -p "$(dirname -- "$live_path")"
      mv "$saved_path" "$live_path"
    elif [ -f "$BACKUP_DIR/MISSING_PATHS" ] && grep -Fqx "$live_rel" "$BACKUP_DIR/MISSING_PATHS"; then
      if [ -L "$live_path" ] && [ "$(readlink "$live_path")" = "$source_path" ]; then
        rm "$live_path"
      fi
    fi
  done < "$MANIFEST"
  if [ "$AGENTS_MIGRATED" -eq 1 ]; then
    if [ -L "$AGENTS_DEST" ]; then
      rm "$AGENTS_DEST"
    elif [ -d "$AGENTS_DEST" ]; then
      rm -rf "$AGENTS_DEST"
    fi
    saved_agents=$(backup_path "$AGENTS_REL")
    if [ -L "$saved_agents" ]; then
      mkdir -p "$(dirname -- "$AGENTS_DEST")"
      mv "$saved_agents" "$AGENTS_DEST"
    fi
  fi
  printf 'Rollback source: %s\n' "$BACKUP_DIR" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --backup-dir)
      [ "$#" -ge 2 ] || fail "--backup-dir requires a path"
      BACKUP_DIR=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[ -f "$MANIFEST" ] || fail "link manifest is missing: $MANIFEST"

if [ -e "$LEGACY_CATEGORY_CONFIG" ] || [ -L "$LEGACY_CATEGORY_CONFIG" ]; then
  fail "categories.json is no longer supported at $LEGACY_CATEGORY_CONFIG. Migrate its values to $AIO_CONFIG under \"categories\", then rename the legacy file to a backup and rerun the installer. The installer will not modify or delete it."
fi

if [ -L "$AGENTS_DEST" ]; then
  [ "$(readlink "$AGENTS_DEST")" = "$AGENTS_SOURCE" ] || fail "refusing unexpected agents directory symlink: $AGENTS_DEST"
  [ -d "$AGENTS_DEST" ] || fail "expected agents directory symlink is broken: $AGENTS_DEST"
  AGENTS_DIRECTORY_SYMLINK=1
  printf '%s\n' "$AGENTS_DEST -> migrate to a user-owned directory"
elif [ -e "$AGENTS_DEST" ] && [ ! -d "$AGENTS_DEST" ]; then
  fail "expected agents path to be a directory: $AGENTS_DEST"
fi

if [ -L "$LEGACY_OMO_DEST" ] && [ "$(readlink "$LEGACY_OMO_DEST")" = "$LEGACY_OMO_SOURCE" ]; then
  printf '%s\n' "$LEGACY_OMO_DEST -> remove obsolete repository-managed symlink"
elif [ -e "$LEGACY_OMO_DEST" ] || [ -L "$LEGACY_OMO_DEST" ]; then
  printf '%s\n' "Preserving non-managed legacy OMO config: $LEGACY_OMO_DEST"
fi

# Complete validation before moving any live path.
while IFS='|' read -r source_rel live_rel kind; do
  case "$source_rel" in ''|'#'*) continue ;; esac
  source_path="$REPO_ROOT/$source_rel"
  live_path="$HOME/$live_rel"
  case "$kind" in
    file) [ -f "$source_path" ] || fail "expected repository file is missing: $source_path" ;;
    directory) [ -d "$source_path" ] || fail "expected repository directory is missing: $source_path" ;;
    *) fail "invalid manifest kind for $source_rel: $kind" ;;
  esac

  if [ -L "$live_path" ]; then
    [ "$(readlink "$live_path")" = "$source_path" ] || fail "refusing unexpected symlink: $live_path"
    [ -e "$live_path" ] || fail "expected symlink is broken: $live_path"
  elif [ -e "$live_path" ]; then
    if [ "$kind" = "file" ]; then
      [ -f "$live_path" ] || fail "expected a file at: $live_path"
    else
      [ -d "$live_path" ] || fail "expected a directory at: $live_path"
    fi
    same_source "$source_path" "$live_path" "$kind" || fail "live content differs from canonical source: $live_path"
  elif [ -e "$(dirname -- "$live_path")" ] && [ ! -d "$(dirname -- "$live_path")" ]; then
    fail "live parent is not a directory: $(dirname -- "$live_path")"
  fi
  printf '%s -> %s\n' "$live_path" "$source_path"
done < "$MANIFEST"

if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s\n' "Dry run complete; no live paths changed."
  exit 0
fi

if [ -L "$LEGACY_OMO_DEST" ] && [ "$(readlink "$LEGACY_OMO_DEST")" = "$LEGACY_OMO_SOURCE" ]; then
  rm "$LEGACY_OMO_DEST"
fi

if [ -z "$BACKUP_DIR" ]; then
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  BACKUP_DIR="$DATA_ROOT/backups/migrations/$timestamp"
fi
[ ! -e "$BACKUP_DIR" ] || fail "backup path already exists: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR/files"
: > "$BACKUP_DIR/MISSING_PATHS"

MIGRATING=1
trap 'rollback' HUP INT TERM EXIT

if [ "$AGENTS_DIRECTORY_SYMLINK" -eq 1 ]; then
  saved_agents=$(backup_path "$AGENTS_REL")
  mkdir -p "$(dirname -- "$saved_agents")"
  mv "$AGENTS_DEST" "$saved_agents"
  AGENTS_MIGRATED=1
  mkdir -p "$AGENTS_DEST"
  for source_item in "$AGENTS_SOURCE"/* "$AGENTS_SOURCE"/.[!.]* "$AGENTS_SOURCE"/..?*; do
    [ -e "$source_item" ] || [ -L "$source_item" ] || continue
    agent_name=${source_item##*/}
    is_builtin_agent_name "$agent_name" && continue
    cp -pPR "$source_item" "$AGENTS_DEST/$agent_name"
  done
  printf '%s\n' "Migrated the old agents directory symlink; custom entries were copied into the user-owned directory"
fi

# Back up every path first. No symlink exists until this phase completes.
while IFS='|' read -r source_rel live_rel kind; do
  case "$source_rel" in ''|'#'*) continue ;; esac
  source_path="$REPO_ROOT/$source_rel"
  live_path="$HOME/$live_rel"
  saved_path=$(backup_path "$live_rel")
  if [ -L "$live_path" ]; then
    continue
  elif [ -e "$live_path" ]; then
    same_source "$source_path" "$live_path" "$kind" || fail "live content changed after preflight: $live_path"
    mkdir -p "$(dirname -- "$saved_path")"
    mv "$live_path" "$saved_path"
  else
    printf '%s\n' "$live_rel" >> "$BACKUP_DIR/MISSING_PATHS"
  fi
done < "$MANIFEST"

find "$BACKUP_DIR/files" -type f -exec shasum -a 256 {} \; > "$BACKUP_DIR/PRE_MIGRATION_SHA256SUMS"

while IFS='|' read -r source_rel live_rel kind; do
  case "$source_rel" in ''|'#'*) continue ;; esac
  source_path="$REPO_ROOT/$source_rel"
  live_path="$HOME/$live_rel"
  if [ -L "$live_path" ]; then
    continue
  fi
  mkdir -p "$(dirname -- "$live_path")"
  ln -s "$source_path" "$live_path"
  [ -e "$live_path" ] || fail "created symlink is broken: $live_path"
  [ "$(readlink "$live_path")" = "$source_path" ] || fail "created symlink has the wrong target: $live_path"
done < "$MANIFEST"

MIGRATING=0
trap - HUP INT TERM EXIT
printf 'Migration complete. Backup retained at: %s\n' "$BACKUP_DIR"
