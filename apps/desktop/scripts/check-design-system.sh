#!/usr/bin/env bash
# Design-system enforcement for the desktop app + shared UI packages.
#
# Type-scale rule: semantic tokens (text-ui, text-ui-sm, text-composer,
# text-title, text-hero, plus the base text-xs/sm/base/chat/lg/xl scale) are
# the only legal spelling for font sizes and line heights. Arbitrary px
# utilities — text-[13px], leading-[18px] — fail the build unless the file
# carries a justified entry in TYPE_ALLOWLIST below (raw px is the exception,
# never the default).
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
ARBITRARY_TYPE_PATTERN='text-\[[0-9.]+px\]|leading-\[[0-9.]+px\]'

# Justified raw-px survivors. Every entry states why it cannot ride a token
# yet; anything not listed fails. "content scale, round 2" = will key off
# --text-chat / --diffs-font-size / --readable-code-font-size in the
# content-scale pass rather than the UI scale.
TYPE_ALLOWLIST=(
  "src/components/content/ui/MarkdownRenderer.tsx"                # content scale, round 2: markdown prose headings key off --text-chat
  "src/components/content/ui/HighlightedCodePanel.tsx"            # content scale, round 2: code-panel gutter keys off --readable-code-font-size
  "src/components/content/ui/diff/ChatDiffViewer.tsx"             # content scale, round 2: diff labels key off --diffs-font-size
  "src/components/content/ui/diff/SplitDiffViewer.tsx"            # content scale, round 2: diff labels key off --diffs-font-size
  "src/components/content/ui/diff/UnifiedDiffViewer.tsx"          # content scale, round 2: diff line numbers/markers key off --diffs-font-size
  "../packages/product-ui/src/chat/transcript/MarkdownBody.tsx"   # content scale, round 2: markdown prose headings key off --text-chat
  "src/components/brand/ProliferateLogo.tsx"                      # 32px brand logotype; scale tops out at text-hero (28px)
  "src/components/feedback/UpdateDialogContent.tsx"               # 15px dialog headline sits between text-lg (14) and text-title (20); no token
  "src/components/workspace/git/GitReviewStatusBadge.tsx"         # 9px review-state badge; nothing below text-sm (10px) on the scale
  "src/components/workspace/git/GitReviewTargetSelector.tsx"      # 9px badge (no token below text-sm) + 18px leading centering 10px label in h-6 trigger
  "src/components/workspace/git/GitReviewBaseSelector.tsx"        # 18px leading centering 10px label in h-6 trigger; no token pairs text-sm with 18px
  "src/components/workspace/pane/PaneFileTree.tsx"                # 9px count badge; nothing below text-sm (10px) on the scale
  "src/components/workspace/shell/tabs/TabGroupPill.tsx"          # 13px leading centering 10px label in h-5 pill; no 13px leading token
  "../packages/product-ui/src/repos/AddRepoFlow.tsx"              # 15px dialog titles sit between text-lg (14) and text-title (20); no token
  "../packages/product-ui/src/sidebar/ProductSidebarShowToggleRow.tsx" # 18px leading on 10px toggle pill; no token pairs text-sm with 18px
  "../packages/ui/src/primitives/CommandPalette.tsx"              # palette input 21px leading on text-base; no token pairs 11px with 21px
)

type_token_allowed() {
  local f=$1 a
  for a in "${TYPE_ALLOWLIST[@]}"; do
    [[ "$f" == "$a" ]] && return 0
  done
  return 1
}

TYPE_HITS=$(grep -rEln --exclude='*.test.*' "$ARBITRARY_TYPE_PATTERN" "${TYPE_ROOTS[@]}" 2>/dev/null || true)
for f in $TYPE_HITS; do
  if ! type_token_allowed "$f"; then
    echo "FAIL [arbitrary type utility]: $f"
    grep -En "$ARBITRARY_TYPE_PATTERN" "$f"
    FAIL=1
  fi
done

# tailwind-merge must be imported via the configured wrapper: the stock config
# classifies our custom text-* size tokens as COLORS and silently deletes them
# on merge. Only the wrapper module itself may import the library.
TW_MERGE_MODULE="../packages/ui/src/utils/tw-merge.ts"
RAW_TW_HITS=$(grep -rln 'from "tailwind-merge"' "${TYPE_ROOTS[@]}" 2>/dev/null || true)
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

echo "Design-system check passed."
