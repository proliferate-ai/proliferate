import {
  COMPOSER_SHORTCUT_GROUPS,
  COMPOSER_SHORTCUTS,
  SHORTCUT_GROUPS,
  SHORTCUTS,
} from "@/config/shortcuts";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";

interface ShortcutRowProps {
  description: string;
  label: string;
}

function ShortcutBadge({ label }: { label: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background px-2 font-mono text-[0.6875rem] font-medium leading-none text-foreground shadow-sm">
      {label}
    </kbd>
  );
}

function ShortcutRow({ description, label }: ShortcutRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 p-3">
      <span className="min-w-0 text-sm text-foreground">{description}</span>
      <ShortcutBadge label={label} />
    </div>
  );
}

export function KeyboardShortcutsPane() {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Keyboard"
        description="App, workspace, tab, and composer shortcuts."
      />

      {SHORTCUT_GROUPS.map((group) => (
        <SettingsCard key={group.title}>
          <div className="px-3 py-2">
            <h3 className="text-sm font-medium text-foreground">{group.title}</h3>
          </div>
          {group.shortcutKeys.map((shortcutKey) => {
            const shortcut = SHORTCUTS[shortcutKey];
            return (
              <ShortcutRow
                key={shortcut.id}
                description={shortcut.description}
                label={getShortcutDisplayLabel(shortcut)}
              />
            );
          })}
        </SettingsCard>
      ))}

      {COMPOSER_SHORTCUT_GROUPS.map((group) => (
        <SettingsCard key={group.title}>
          <div className="px-3 py-2">
            <h3 className="text-sm font-medium text-foreground">{group.title}</h3>
          </div>
          {group.shortcutKeys.map((shortcutKey) => {
            const shortcut = COMPOSER_SHORTCUTS[shortcutKey];
            return (
              <ShortcutRow
                key={shortcut.key}
                description={shortcut.description}
                label={getShortcutDisplayLabel(shortcut)}
              />
            );
          })}
        </SettingsCard>
      ))}
    </section>
  );
}
