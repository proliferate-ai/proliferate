import type { ShortcutDef } from "@/config/shortcuts";
import {
  getShortcutDisplayLabel,
  type ShortcutDigit,
} from "@/lib/domain/shortcuts/matching";

export function shortcutDigitForRangeIndex(
  index: number,
  total: number,
): ShortcutDigit | null {
  if (index < 0 || total <= 0 || index >= total) {
    return null;
  }
  if (index < 8) {
    return (index + 1) as ShortcutDigit;
  }
  return index === total - 1 ? 9 : null;
}

export function getShortcutRangeItemDisplayLabel(
  shortcut: Pick<ShortcutDef, "label" | "nonMacLabel">,
  digit: ShortcutDigit,
): string {
  return getShortcutDisplayLabel(shortcut).replace("1-9", String(digit));
}

export function buildShortcutRangeLabelById(
  ids: readonly string[],
  shortcut: Pick<ShortcutDef, "label" | "nonMacLabel">,
): Map<string, string> {
  return new Map(ids.flatMap((id, index) => {
    const digit = shortcutDigitForRangeIndex(index, ids.length);
    return digit
      ? [[id, getShortcutRangeItemDisplayLabel(shortcut, digit)]]
      : [];
  }));
}
