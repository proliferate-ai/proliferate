import type { ShortcutDigit } from "@/lib/domain/shortcuts/matching";
import type { RightPanelHeaderEntry } from "@/lib/domain/workspaces/shell/right-panel-header-entry";
import type { RightPanelHeaderEntryKey } from "@/lib/domain/workspaces/shell/right-panel-model";

export function resolveRelativeRightPanelHeaderEntryKey({
  activeEntryKey,
  delta,
  entries,
}: {
  activeEntryKey: RightPanelHeaderEntryKey;
  delta: -1 | 1;
  entries: readonly RightPanelHeaderEntry[];
}): RightPanelHeaderEntryKey | null {
  const keys = entries.map((entry) => entry.key);
  if (keys.length === 0) {
    return null;
  }

  const activeIndex = keys.indexOf(activeEntryKey);
  if (activeIndex < 0) {
    return delta < 0 ? keys[keys.length - 1] ?? null : keys[0] ?? null;
  }

  const nextIndex = (activeIndex + delta + keys.length) % keys.length;
  return keys[nextIndex] ?? null;
}

export function resolveRightPanelHeaderEntryKeyByShortcutIndex(
  entries: readonly RightPanelHeaderEntry[],
  digit: ShortcutDigit,
): RightPanelHeaderEntryKey | null {
  const keys = entries.map((entry) => entry.key);
  if (keys.length === 0) {
    return null;
  }

  if (digit === 9) {
    return keys[keys.length - 1] ?? null;
  }

  return keys[digit - 1] ?? null;
}
