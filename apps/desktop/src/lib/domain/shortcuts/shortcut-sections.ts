import {
  COMPOSER_SHORTCUT_GROUPS,
  SHORTCUT_GROUPS,
} from "@/config/shortcuts/groups";
import {
  COMPOSER_SHORTCUTS,
  type ComposerShortcutKey,
} from "@/config/shortcuts/composer-shortcuts";
import { SHORTCUTS, type ShortcutKey } from "@/config/shortcuts/registry";
import type { ComposerShortcutDef, ShortcutDef } from "@/config/shortcuts/types";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";

export interface ShortcutEntryView {
  id: string;
  command: string;
  labels: string[];
}

export interface ShortcutSectionView {
  title: string;
  entries: ShortcutEntryView[];
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

function buildShortcutEntries(shortcutKeys: readonly ShortcutKey[]): ShortcutEntryView[] {
  const entriesById = new Map<string, ShortcutEntryView>();

  for (const shortcutKey of shortcutKeys) {
    const shortcut = SHORTCUTS[shortcutKey];
    const entryId = `${shortcut.id}:${shortcut.description}`;
    const label = getShortcutDisplayLabel(shortcut);
    const existingEntry = entriesById.get(entryId);

    if (existingEntry) {
      if (!existingEntry.labels.includes(label)) {
        existingEntry.labels.push(label);
      }
      continue;
    }

    entriesById.set(entryId, {
      id: entryId,
      command: shortcut.description,
      labels: [label],
    });
  }

  return [...entriesById.values()];
}

/**
 * Grouped, search-filtered shortcut sections shared by the settings pane and
 * the sidebar keyboard-shortcuts dialog. Pure: pass the normalized (trimmed,
 * lowercased) query.
 */
export function buildShortcutSections(normalizedQuery: string): ShortcutSectionView[] {
  const shortcutGroups = SHORTCUT_GROUPS.map((group) => {
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
  }).filter((group) => group.shortcutKeys.length > 0);

  const composerShortcutGroups = COMPOSER_SHORTCUT_GROUPS.map((group) => {
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
  }).filter((group) => group.shortcutKeys.length > 0);

  return [
    ...shortcutGroups.map((group) => ({
      title: group.title,
      entries: buildShortcutEntries(group.shortcutKeys),
    })),
    ...composerShortcutGroups.map((group) => ({
      title: group.title,
      entries: group.shortcutKeys.map((shortcutKey) => {
        const shortcut = COMPOSER_SHORTCUTS[shortcutKey];
        return {
          id: `${group.title}:${shortcut.key}:${shortcutKey}`,
          command: shortcut.description,
          labels: [getShortcutDisplayLabel(shortcut)],
        };
      }),
    })),
  ];
}
