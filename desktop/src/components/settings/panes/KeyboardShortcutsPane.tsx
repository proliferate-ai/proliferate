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
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { Search } from "@/components/ui/icons";
import { Input } from "@proliferate/ui/primitives/Input";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";

interface ShortcutTableEntry {
  id: string;
  command: string;
  groupTitle: string;
  label: string;
}

function ShortcutBadge({ label }: { label: string }) {
  return (
    <kbd className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-md border-0 bg-current/10 px-2 py-1 font-sans text-sm leading-none text-current shadow-none">
      {label}
    </kbd>
  );
}

function ShortcutRow({ command, groupTitle, label }: ShortcutTableEntry) {
  return (
    <tr className="group border-t border-border-light align-middle first:border-t-0 hover:bg-foreground/5">
      <td className="px-4 py-2">
        <span className="block truncate text-sm text-foreground">{command}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{groupTitle}</span>
      </td>
      <td className="px-4 py-2">
        <div className="flex min-h-8 items-center text-muted-foreground">
          <ShortcutBadge label={label} />
        </div>
      </td>
    </tr>
  );
}

function ShortcutTable({ entries }: { entries: ShortcutTableEntry[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border-light bg-surface-elevated shadow-subtle">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] table-fixed border-collapse text-sm">
          <colgroup>
            <col />
            <col className="w-56" />
          </colgroup>
          <thead className="text-left text-muted-foreground">
            <tr className="border-b border-border-light bg-foreground/5">
              <th className="px-4 py-2 text-xs font-medium">Command</th>
              <th className="px-4 py-2 text-xs font-medium">Keybinding</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <ShortcutRow key={entry.id} {...entry} />
            ))}
          </tbody>
        </table>
      </div>
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

  const tableEntries = useMemo<ShortcutTableEntry[]>(() => [
    ...shortcutGroups.flatMap((group) => group.shortcutKeys.map((shortcutKey) => {
      const shortcut = SHORTCUTS[shortcutKey];
      return {
        id: shortcut.id,
        command: shortcut.description,
        groupTitle: group.title,
        label: getShortcutDisplayLabel(shortcut),
      };
    })),
    ...composerShortcutGroups.flatMap((group) => group.shortcutKeys.map((shortcutKey) => {
      const shortcut = COMPOSER_SHORTCUTS[shortcutKey];
      return {
        id: `${group.title}:${shortcut.key}:${shortcutKey}`,
        command: shortcut.description,
        groupTitle: group.title,
        label: getShortcutDisplayLabel(shortcut),
      };
    })),
  ], [composerShortcutGroups, shortcutGroups]);

  return (
    <section className="space-y-5">
      <SettingsPageHeader
        title="Keyboard shortcuts"
      />

      <div className="space-y-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search shortcuts"
            aria-label="Search keyboard shortcuts"
            className="h-9 border-border-light bg-transparent pl-8"
          />
        </div>

        {tableEntries.length > 0 ? (
          <ShortcutTable entries={tableEntries} />
        ) : (
          <div className="rounded-lg border border-border-light bg-surface-elevated px-4 py-8 text-center text-sm text-muted-foreground shadow-subtle">
            No shortcuts found
          </div>
        )}
      </div>
    </section>
  );
}
