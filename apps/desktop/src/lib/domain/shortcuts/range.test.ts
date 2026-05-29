import { describe, expect, it } from "vitest";
import {
  resolveShortcutRangeDigitTarget,
  shortcutDigitForRangeIndex,
} from "@/lib/domain/shortcuts/range";

describe("shortcut range", () => {
  it("labels first eight range targets and uses digit nine for the final target", () => {
    expect(
      Array.from({ length: 10 }, (_, index) =>
        shortcutDigitForRangeIndex(index, 10),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, null, 9]);
    expect(
      Array.from({ length: 9 }, (_, index) =>
        shortcutDigitForRangeIndex(index, 9),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(
      Array.from({ length: 4 }, (_, index) =>
        shortcutDigitForRangeIndex(index, 4),
      ),
    ).toEqual([1, 2, 3, 4]);
  });

  it("resolves range shortcut digits from the same first-eight-and-final rule", () => {
    const targets = Array.from(
      { length: 10 },
      (_, index) => `target-${index + 1}`,
    );

    expect(resolveShortcutRangeDigitTarget(targets, 1)).toBe("target-1");
    expect(resolveShortcutRangeDigitTarget(targets, 8)).toBe("target-8");
    expect(resolveShortcutRangeDigitTarget(targets, 9)).toBe("target-10");
    expect(resolveShortcutRangeDigitTarget([], 9)).toBeNull();
  });
});
