import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { HarnessPanelBlock, type HarnessBlockVariant } from "./HarnessPanelBlock";

// Reserved for harness-specific settings (e.g. the Claude Chrome flag). No
// harness ships any yet, so the section stays gated off and renders nothing.
const HARNESS_SETTINGS_ENABLED_KINDS: ReadonlySet<string> = new Set();

interface HarnessSettingsSectionProps {
  harnessKind: string;
  variant?: HarnessBlockVariant;
}

export function HarnessSettingsSection({
  harnessKind,
  variant = "section",
}: HarnessSettingsSectionProps) {
  if (!HARNESS_SETTINGS_ENABLED_KINDS.has(harnessKind)) {
    return null;
  }
  return (
    <HarnessPanelBlock variant={variant} title={HARNESS_PANE_COPY.harnessSettingsTitle}>
      <SettingsRow
        label={HARNESS_PANE_COPY.harnessSettingsPlaceholderLabel}
        description={HARNESS_PANE_COPY.harnessSettingsPlaceholderDescription}
      />
    </HarnessPanelBlock>
  );
}
