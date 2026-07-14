import type { SettingsSection } from "#product/config/settings";

export interface SettingsShortcutSectionTarget {
  disabled: boolean;
  section: SettingsSection;
}

export function buildSettingsShortcutSectionTargets(
  sectionOrder: readonly SettingsSection[],
  disabledSections: Partial<Record<SettingsSection, boolean>> | undefined,
): SettingsShortcutSectionTarget[] {
  return sectionOrder.map((section) => ({
    section,
    disabled: Boolean(disabledSections?.[section]),
  }));
}
