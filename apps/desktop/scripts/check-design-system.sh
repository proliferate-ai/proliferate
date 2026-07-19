#!/usr/bin/env bash
# Design-system enforcement for the desktop app + shared UI packages.
#
# Type-scale rule: semantic tokens (text-ui, text-ui-sm, text-composer,
# text-title, text-hero, plus the base text-xs/sm/base/chat/lg/xl scale) are
# the only legal spelling for font sizes and line heights. Arbitrary length
# utilities — text-[13px], leading-[18px], and rem/em spellings like
# text-[0.8125rem] — fail the build unless the file carries a justified entry
# in TYPE_ALLOWLIST below (a raw length is the exception, never the default).
#
# Settings-structure rule: pane/screen code expresses structure through
# SettingsRow/SettingsSection/SettingsPageHeader/SettingsEmptyState instead of
# hand-typing the scale, and card-era primitives stay retired.
set -euo pipefail

cd "$(dirname "$0")/.."
SETTINGS=src/components/settings
FAIL=0

# ---------------------------------------------------------------------------
# Settings structure
# ---------------------------------------------------------------------------

# Structural one-offs with no primitive would live here (paths relative to
# apps/desktop). Currently empty: every settings surface rides the shared
# primitives.
ALLOWLIST=()

is_allowed() {
  local f=$1 a
  for a in ${ALLOWLIST[@]+"${ALLOWLIST[@]}"}; do
    [[ "$f" == "$a" ]] && return 0
  done
  return 1
}

check() {
  local pattern=$1 label=$2
  local hits
  hits=$(grep -rln "$pattern" "$SETTINGS" --include='*.tsx' 2>/dev/null || true)
  for f in $hits; do
    if ! is_allowed "$f"; then
      echo "FAIL [$label]: $f"
      FAIL=1
    fi
  done
}

# Card-era primitives must not come back anywhere in desktop settings.
# Any import path ending in /SettingsCard or /SettingsCardRow fails.
RETIRED_PRIMITIVE_PATTERN='/SettingsCard(Row)?["'"'"']'
if grep -rEn "$RETIRED_PRIMITIVE_PATTERN" "$SETTINGS" --include='*.tsx' >/dev/null 2>&1; then
  echo "FAIL [retired card primitive]:"
  grep -rEn "$RETIRED_PRIMITIVE_PATTERN" "$SETTINGS" --include='*.tsx'
  FAIL=1
fi

# Raw type-scale values belong in shared primitives, not panes.
check 'text-\[11px\]' "raw 11px (use SettingsSection eyebrow)"
check 'text-\[12px\]' "raw 12px (use SettingsRow/SettingsSection description)"
check 'text-\[13px\]' "raw 13px (use SettingsRow label / SettingsEmptyState)"
check 'text-\[20px\]' "raw 20px (use SettingsPageHeader)"
check 'tracking-\[0.06em\]' "raw eyebrow tracking (use SettingsSection)"

# ---------------------------------------------------------------------------
# Semantic type tokens
# ---------------------------------------------------------------------------

TYPE_ROOTS=(src ../packages/ui/src ../packages/product-ui/src)
ARBITRARY_TYPE_PATTERN='text-\[[0-9.]+(px|rem|em)\]|leading-\[[0-9.]+(px|rem|em)\]'

TYPE_HITS=$(grep -rEln --exclude='*.test.*' "$ARBITRARY_TYPE_PATTERN" "${TYPE_ROOTS[@]}" 2>/dev/null || true)
for f in $TYPE_HITS; do
  echo "FAIL [arbitrary type utility]: $f"
  grep -En "$ARBITRARY_TYPE_PATTERN" "$f"
  FAIL=1
done

# tailwind-merge must be imported via the configured wrapper: the stock config
# classifies our custom text-* size tokens as COLORS and silently deletes them
# on merge. Only the wrapper module itself may import the library. This rule
# scans apps/web too (every workspace that depends on tailwind-merge); web is
# deliberately NOT in TYPE_ROOTS — its px conventions are untouched here.
TW_MERGE_ROOTS=("${TYPE_ROOTS[@]}" ../web/src)
TW_MERGE_MODULE="../packages/ui/src/utils/tw-merge.ts"
RAW_TW_HITS=$(grep -rln 'from "tailwind-merge"' "${TW_MERGE_ROOTS[@]}" 2>/dev/null || true)
for f in $RAW_TW_HITS; do
  if [[ "$f" != "$TW_MERGE_MODULE" ]]; then
    echo "FAIL [raw tailwind-merge import — use @proliferate/ui/utils/tw-merge]: $f"
    FAIL=1
  fi
done

if [[ $FAIL -eq 1 ]]; then
  echo
  echo "Design-system check failed. Spell type through the semantic tokens"
  echo "(text-ui / text-ui-sm / text-composer / text-title / text-hero and the"
  echo "base scale), route settings markup through the shared primitives in"
  echo "@proliferate/product-ui/settings, or add a justified one-off to the"
  echo "relevant allowlist in $0."
  exit 1
fi

# The focused repository guard also covers fixed display utilities, numeric
# third-party font adapters, Lucide/custom SVG dimensions, and status dots in
# every shared Desktop/Web production package. It intentionally has no
# callsite allowlist.
python3 ../../scripts/check_appearance_scaling.py

echo "Design-system check passed."
