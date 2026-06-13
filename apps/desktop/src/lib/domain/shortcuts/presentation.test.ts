import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "@/config/shortcuts/registry";
import { buildShortcutRangeLabelById } from "@/lib/domain/shortcuts/presentation";

describe("shortcut presentation", () => {
  it("builds labels that match range shortcut digit resolution", () => {
    const labels = buildShortcutRangeLabelById(
      Array.from({ length: 10 }, (_, index) => `workspace-${index + 1}`),
      SHORTCUTS.workspaceByIndex,
    );

    expect(labels.get("workspace-1")).toBe("⌘1");
    expect(labels.get("workspace-8")).toBe("⌘8");
    expect(labels.has("workspace-9")).toBe(false);
    expect(labels.get("workspace-10")).toBe("⌘9");
  });
});
