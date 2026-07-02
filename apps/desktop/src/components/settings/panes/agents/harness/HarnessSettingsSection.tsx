import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";

// Reserved for harness-specific settings (e.g. the Claude Chrome flag). No
// harness ships any yet, so the section stays gated off and renders nothing.
const HARNESS_SETTINGS_ENABLED_KINDS: ReadonlySet<string> = new Set();

interface HarnessSettingsSectionProps {
  harnessKind: string;
}

export function HarnessSettingsSection({ harnessKind }: HarnessSettingsSectionProps) {
  if (!HARNESS_SETTINGS_ENABLED_KINDS.has(harnessKind)) {
    return null;
  }
  return (
    <SettingsSection title={HARNESS_PANE_COPY.harnessSettingsTitle}>
      <SettingsRow
        label={HARNESS_PANE_COPY.harnessSettingsPlaceholderLabel}
        description={HARNESS_PANE_COPY.harnessSettingsPlaceholderDescription}
      />
    </SettingsSection>
  );
}
