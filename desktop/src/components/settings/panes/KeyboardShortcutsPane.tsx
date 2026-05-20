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

interface ShortcutEntryView {
  id: string;
  command: string;
  label: string;
}

interface ShortcutSectionView {
  title: string;
  entries: ShortcutEntryView[];
}

function ShortcutBadge({ label }: { label: string }) {
  return (
    <kbd className="inline-flex min-h-7 shrink-0 items-center justify-center rounded-md border-0 bg-current/10 px-2 py-1 font-sans text-xs leading-none text-current shadow-none">
      {label}
    </kbd>
  );
}

function ShortcutRow({ command, label }: ShortcutEntryView) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 hover:bg-foreground/5">
      <span className="min-w-0 truncate text-sm text-foreground">{command}</span>
      <div className="ml-auto flex min-h-7 items-center justify-end text-muted-foreground">
        <ShortcutBadge label={label} />
      </div>
    </li>
  );
}

function ShortcutSection({ section }: { section: ShortcutSectionView }) {
  const sectionId = `keyboard-shortcuts-${section.title.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <section
      aria-labelledby={sectionId}
      className="overflow-hidden rounded-lg border border-border-light bg-surface-elevated shadow-subtle"
    >
      <header className="border-b border-border-light bg-foreground/5 px-4 py-2.5">
        <h3
          id={sectionId}
          className="text-sm font-medium text-foreground"
        >
          {section.title}
        </h3>
      </header>
      <ul className="divide-y divide-border-light">
        {section.entries.map((entry) => (
          <ShortcutRow key={entry.id} {...entry} />
        ))}
      </ul>
    </section>
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

  const sections = useMemo<ShortcutSectionView[]>(() => [
    ...shortcutGroups.map((group) => ({
      title: group.title,
      entries: group.shortcutKeys.map((shortcutKey) => {
        const shortcut = SHORTCUTS[shortcutKey];
        return {
          id: shortcut.id,
          command: shortcut.description,
          label: getShortcutDisplayLabel(shortcut),
        };
      }),
    })),
    ...composerShortcutGroups.map((group) => ({
      title: group.title,
      entries: group.shortcutKeys.map((shortcutKey) => {
        const shortcut = COMPOSER_SHORTCUTS[shortcutKey];
        return {
          id: `${group.title}:${shortcut.key}:${shortcutKey}`,
          command: shortcut.description,
          label: getShortcutDisplayLabel(shortcut),
        };
      }),
    })),
  ], [composerShortcutGroups, shortcutGroups]);

  const hasShortcuts = sections.length > 0;

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

        {hasShortcuts ? (
          <div className="space-y-3">
            {sections.map((section) => (
              <ShortcutSection key={section.title} section={section} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border-light bg-surface-elevated px-4 py-8 text-center text-sm text-muted-foreground shadow-subtle">
            No shortcuts found
          </div>
        )}
      </div>
    </section>
  );
}
