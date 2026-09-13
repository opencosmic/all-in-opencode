#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
MANIFEST="$SCRIPT_DIR/links.tsv"
CATEGORY_CONFIG_SOURCE="$REPO_ROOT/opencode/categories.json"
CATEGORY_CONFIG_DEST="$HOME/.config/opencode/categories.json"
DATA_ROOT=${OPENCODE_WORKFLOW_DATA_ROOT:-"$HOME/Workspace/data/opencode-workflow"}
LEGACY_OMO_SOURCE="$REPO_ROOT/omo/omo.jsonc"
LEGACY_OMO_DEST="$HOME/.omo/omo.jsonc"
DRY_RUN=0
BACKUP_DIR=""
MIGRATING=0

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

if [ -L "$CATEGORY_CONFIG_DEST" ] && [ "$(readlink "$CATEGORY_CONFIG_DEST")" = "$CATEGORY_CONFIG_SOURCE" ]; then
  if [ -f "$CATEGORY_CONFIG_SOURCE" ]; then
    category_config_temp=$(mktemp "$CATEGORY_CONFIG_DEST.migration.XXXXXX") ||
      fail "could not create a temporary local category config"
    if ! cp -p "$CATEGORY_CONFIG_DEST" "$category_config_temp"; then
      rm "$category_config_temp"
      fail "could not preserve the legacy local category config"
    fi
    if ! mv -f "$category_config_temp" "$CATEGORY_CONFIG_DEST"; then
      rm "$category_config_temp"
      fail "could not migrate the legacy local category config"
    fi
    printf '%s\n' "Migrated legacy repository-managed category config to $CATEGORY_CONFIG_DEST"
  else
    rm "$CATEGORY_CONFIG_DEST"
    printf '%s\n' "Removed broken legacy repository-managed category config symlink"
  fi
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
