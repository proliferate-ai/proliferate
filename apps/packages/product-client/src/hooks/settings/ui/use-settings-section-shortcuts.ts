import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { type SettingsSection } from "#product/config/settings";
import { useShortcutHandler } from "#product/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { resolveShortcutRangeDigitTarget } from "#product/lib/domain/shortcuts/range";
import type { SettingsShortcutSectionTarget } from "#product/lib/domain/settings/shortcut-targets";

interface UseSettingsSectionShortcutsArgs {
  targets: readonly SettingsShortcutSectionTarget[];
  onSelectSection: (section: SettingsSection) => void;
}

export function useSettingsSectionShortcuts({
  targets,
  onSelectSection,
}: UseSettingsSectionShortcutsArgs): void {
  useShortcutHandler(SHORTCUTS.settingsSectionByIndex.id, ({ digit }) => {
    if (!digit) {
      return false;
    }

    const target = resolveShortcutRangeDigitTarget(targets, digit);
    if (!target || target.disabled) {
      return false;
    }

    onSelectSection(target.section);
  }, { enabled: targets.length > 0 });
}
