import { useMemo, useState } from "react";
import {
  COMPOSER_SHORTCUT_GROUPS,
  COMPOSER_SHORTCUTS,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  type ComposerShortcutDef,
  type ComposerShortcutKey,
  type ShortcutDef,
  type ShortcutKey,
} from "@/config/shortcuts";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { Input } from "@/components/ui/Input";
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

function ShortcutGroupHeader({ title }: { title: string }) {
  return (
    <div className="rounded-t-lg bg-muted/60 px-3 py-2">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
    </div>
  );
}

function searchTermsForShortcut(
  shortcutKey: ShortcutKey,
  shortcut: ShortcutDef,
  groupTitle: string,
): string[] {
  return [
    groupTitle,
    shortcut.description,
    shortcut.id,
    shortcut.label,
    shortcut.nonMacLabel ?? "",
    getShortcutDisplayLabel(shortcut),
    shortcutKey,
  ];
}

function searchTermsForComposerShortcut(
  shortcutKey: ComposerShortcutKey,
  shortcut: ComposerShortcutDef,
  groupTitle: string,
): string[] {
  return [
    groupTitle,
    shortcut.description,
    shortcut.key,
    shortcut.label,
    shortcut.nonMacLabel ?? "",
    getShortcutDisplayLabel(shortcut),
    shortcutKey,
  ];
}

function matchesQuery(terms: readonly string[], query: string): boolean {
  if (!query) {
    return true;
  }

  return terms.some((term) => term.toLowerCase().includes(query));
}

export function KeyboardShortcutsPane() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const shortcutGroups = useMemo(() => SHORTCUT_GROUPS.map((group) => {
    const groupMatches = matchesQuery([group.title], normalizedQuery);
    const shortcutKeys = groupMatches
      ? group.shortcutKeys
      : group.shortcutKeys.filter((shortcutKey) => matchesQuery(
        searchTermsForShortcut(shortcutKey, SHORTCUTS[shortcutKey], group.title),
        normalizedQuery,
      ));

    return {
      ...group,
      shortcutKeys,
    };
  }).filter((group) => group.shortcutKeys.length > 0), [normalizedQuery]);

  const composerShortcutGroups = useMemo(() => COMPOSER_SHORTCUT_GROUPS.map((group) => {
    const groupMatches = matchesQuery([group.title], normalizedQuery);
    const shortcutKeys = groupMatches
      ? group.shortcutKeys
      : group.shortcutKeys.filter((shortcutKey) => matchesQuery(
        searchTermsForComposerShortcut(
          shortcutKey,
          COMPOSER_SHORTCUTS[shortcutKey],
          group.title,
        ),
        normalizedQuery,
      ));

    return {
      ...group,
      shortcutKeys,
    };
  }).filter((group) => group.shortcutKeys.length > 0), [normalizedQuery]);

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Keyboard"
        description="App, workspace, tab, and composer shortcuts."
      />

      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search shortcuts"
        aria-label="Search keyboard shortcuts"
      />

      {shortcutGroups.map((group) => (
        <SettingsCard key={group.title}>
          <ShortcutGroupHeader title={group.title} />
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

      {composerShortcutGroups.map((group) => (
        <SettingsCard key={group.title}>
          <ShortcutGroupHeader title={group.title} />
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

      {shortcutGroups.length === 0 && composerShortcutGroups.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No shortcuts found
        </div>
      )}
    </section>
  );
}
