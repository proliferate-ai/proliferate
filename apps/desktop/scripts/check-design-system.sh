#!/usr/bin/env bash
# Design-system enforcement for the desktop settings surface.
#
# Rule: raw type-scale values and card-era primitives are only legal inside the
# shared packages (@proliferate/ui, @proliferate/product-ui). Pane/screen code
# expresses structure through SettingsRow/SettingsSection/SettingsPageHeader/
# SettingsEmptyState instead of hand-typing the scale.
#
# Allowlisted one-offs (structural elements with no primitive): table column
# headers, status pills, the sidebar group-heading constant, version strings,
# interactive chrome like the titlebar back button.
set -euo pipefail

cd "$(dirname "$0")/.."
SETTINGS=src/components/settings
FAIL=0

ALLOWLIST=(
  "$SETTINGS/sidebar/SettingsSidebar.tsx"
  "$SETTINGS/screen/SettingsScreen.tsx"
  "$SETTINGS/panes/agent-authentication/AuthenticationMethodsSection.tsx"
  "$SETTINGS/panes/agent-authentication/PersonalAuthInUseSection.tsx"
  "$SETTINGS/panes/ArchivedChatsPane.tsx"
  "$SETTINGS/panes/ModelRegistryPane.tsx"
  "$SETTINGS/panes/OrganizationBudgetsPane.tsx"
  "$SETTINGS/panes/organization/OrganizationMemberLlmBudgets.tsx"
)

is_allowed() {
  local f=$1
  for a in "${ALLOWLIST[@]}"; do
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
if grep -rn "settings/SettingsCard" "$SETTINGS" --include='*.tsx' >/dev/null 2>&1; then
  echo "FAIL [retired card primitive]:"
  grep -rn "settings/SettingsCard" "$SETTINGS" --include='*.tsx'
  FAIL=1
fi

# Raw type-scale values belong in shared primitives, not panes.
check 'text-\[11px\]' "raw 11px (use SettingsSection eyebrow)"
check 'text-\[12px\]' "raw 12px (use SettingsRow/SettingsSection description)"
check 'text-\[13px\]' "raw 13px (use SettingsRow label / SettingsEmptyState)"
check 'text-\[20px\]' "raw 20px (use SettingsPageHeader)"
check 'tracking-\[0.06em\]' "raw eyebrow tracking (use SettingsSection)"

if [[ $FAIL -eq 1 ]]; then
  echo
  echo "Design-system check failed. Route the flagged markup through the shared"
  echo "primitives in @proliferate/product-ui/settings, or add a justified"
  echo "one-off to the allowlist in $0."
  exit 1
fi

echo "Design-system check passed."
