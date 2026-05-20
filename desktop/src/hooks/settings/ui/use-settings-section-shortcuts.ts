import { SHORTCUTS } from "@/config/shortcuts";
import { type SettingsSection } from "@/config/settings";
import { useShortcutHandler } from "@/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { resolveShortcutRangeDigitTarget } from "@/lib/domain/shortcuts/range";
import type { SettingsShortcutSectionTarget } from "@/lib/domain/settings/shortcut-targets";

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
