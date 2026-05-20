import { type SettingsSection } from "@/config/settings";
import { useShortcutHandler } from "@/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { resolveShortcutRangeDigitTarget } from "@/lib/domain/shortcuts/presentation";

interface UseSettingsSectionShortcutsArgs {
  sections: readonly SettingsSection[];
  onSelectSection: (section: SettingsSection) => void;
}

export function useSettingsSectionShortcuts({
  sections,
  onSelectSection,
}: UseSettingsSectionShortcutsArgs): void {
  useShortcutHandler("workspace.tab-by-index", ({ digit }) => {
    if (!digit) {
      return false;
    }

    const section = resolveShortcutRangeDigitTarget(sections, digit);
    if (!section) {
      return false;
    }

    onSelectSection(section);
  }, { enabled: sections.length > 0 });
}
