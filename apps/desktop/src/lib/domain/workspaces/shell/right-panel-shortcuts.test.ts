import { describe, expect, it } from "vitest";
import type { RightPanelHeaderEntry } from "@/lib/domain/workspaces/shell/right-panel-header-entry";
import type { RightPanelHeaderEntryKey } from "@/lib/domain/workspaces/shell/right-panel-model";
import {
  resolveRelativeRightPanelHeaderEntryKey,
  resolveRightPanelHeaderEntryKeyByShortcutIndex,
} from "@/lib/domain/workspaces/shell/right-panel-shortcuts";

describe("right panel shortcut resolution", () => {
  const entries = [
    entry("tool:scratch"),
    entry("tool:git"),
    entry("terminal:t1"),
    entry("terminal:t2"),
  ];

  it("cycles through visible right-panel header entries", () => {
    expect(resolveRelativeRightPanelHeaderEntryKey({
      entries,
      activeEntryKey: "tool:git",
      delta: 1,
    })).toBe("terminal:t1");

    expect(resolveRelativeRightPanelHeaderEntryKey({
      entries,
      activeEntryKey: "tool:scratch",
      delta: -1,
    })).toBe("terminal:t2");
  });

  it("uses the first or last entry when the active entry is stale", () => {
    expect(resolveRelativeRightPanelHeaderEntryKey({
      entries,
      activeEntryKey: "terminal:missing",
      delta: 1,
    })).toBe("tool:scratch");

    expect(resolveRelativeRightPanelHeaderEntryKey({
      entries,
      activeEntryKey: "terminal:missing",
      delta: -1,
    })).toBe("terminal:t2");
  });

  it("resolves digit shortcuts against all right-panel header entries", () => {
    expect(resolveRightPanelHeaderEntryKeyByShortcutIndex(entries, 2)).toBe("tool:git");
    expect(resolveRightPanelHeaderEntryKeyByShortcutIndex(entries, 4)).toBe("terminal:t2");
    expect(resolveRightPanelHeaderEntryKeyByShortcutIndex(entries, 9)).toBe("terminal:t2");
  });
});

function entry(key: RightPanelHeaderEntryKey): RightPanelHeaderEntry {
  return { kind: "tool", key, tool: "scratch" } as RightPanelHeaderEntry;
}
