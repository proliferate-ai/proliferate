import type { ShortcutDef } from "@/config/shortcuts/types";
import {
  getShortcutDisplayLabel,
  type ShortcutDigit,
} from "@/lib/domain/shortcuts/matching";
import { shortcutDigitForRangeIndex } from "@/lib/domain/shortcuts/range";

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
