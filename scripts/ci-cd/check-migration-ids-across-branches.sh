#!/usr/bin/env bash
# Cross-branch alembic revision-id collision check (building-loop law:
# "Alembic revision ids are minted, not authored"). SRV-MIGRATE-2 proves
# uniqueness inside one tree; this proves it across every remote branch, so a
# coordinator runs it before each merge on the train.
#
# Exit 1 if any revision id appears in two or more branches with DIFFERENT
# file contents (the same migration carried by several branches is fine).
set -euo pipefail

remote="${1:-origin}"
git fetch --quiet --prune "$remote"

declare -A id_to_blob   # revision id -> first blob sha seen
declare -A id_to_ref    # revision id -> branch that introduced that blob
collisions=0

while IFS= read -r ref; do
  # Only migration modules; revision id is the module-level `revision = "..."`.
  while IFS=$'\t' read -r blob path; do
    [[ -z "$blob" ]] && continue
    rev="$(git cat-file -p "$blob" | sed -nE 's/^revision(: str)? = "([^"]+)".*/\2/p' | head -1)"
    [[ -z "$rev" ]] && continue
    if [[ -n "${id_to_blob[$rev]:-}" && "${id_to_blob[$rev]}" != "$blob" ]]; then
      echo "COLLISION revision=$rev  ${id_to_ref[$rev]}  vs  $ref ($path)" >&2
      collisions=$((collisions + 1))
    else
      id_to_blob[$rev]="$blob"
      id_to_ref[$rev]="$ref"
    fi
  done < <(git ls-tree -r "$ref" -- server/alembic/versions \
             | awk '$4 ~ /\.py$/ {print $3 "\t" $4}')
done < <(git for-each-ref --format='%(refname:short)' "refs/remotes/$remote/")

if (( collisions > 0 )); then
  echo "$collisions alembic revision id collision(s) across $remote branches." >&2
  exit 1
fi
echo "No alembic revision id collisions across $remote branches."
