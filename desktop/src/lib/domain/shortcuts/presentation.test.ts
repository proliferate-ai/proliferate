import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "@/config/shortcuts";
import {
  buildShortcutRangeLabelById,
  shortcutDigitForRangeIndex,
} from "@/lib/domain/shortcuts/presentation";

describe("shortcut presentation", () => {
  it("labels first eight range targets and uses digit nine for the final target", () => {
    expect(Array.from({ length: 10 }, (_, index) =>
      shortcutDigitForRangeIndex(index, 10)
    )).toEqual([1, 2, 3, 4, 5, 6, 7, 8, null, 9]);
    expect(Array.from({ length: 9 }, (_, index) =>
      shortcutDigitForRangeIndex(index, 9)
    )).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(Array.from({ length: 4 }, (_, index) =>
      shortcutDigitForRangeIndex(index, 4)
    )).toEqual([1, 2, 3, 4]);
  });

  it("builds labels that match range shortcut digit resolution", () => {
    const labels = buildShortcutRangeLabelById(
      Array.from({ length: 10 }, (_, index) => `workspace-${index + 1}`),
      SHORTCUTS.workspaceByIndex,
    );

    expect(labels.get("workspace-1")).toBe("⌘⌥1");
    expect(labels.get("workspace-8")).toBe("⌘⌥8");
    expect(labels.has("workspace-9")).toBe(false);
    expect(labels.get("workspace-10")).toBe("⌘⌥9");
  });
});
