import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { buildShortcutRangeLabelById } from "#product/lib/domain/shortcuts/presentation";

describe("shortcut presentation", () => {
  // Labels are platform-derived (getShortcutDisplayLabel). In Node the test
  // navigator reflects the host OS, so pin macOS for deterministic ⌘ labels
  // across dev machines and Linux CI.
  beforeEach(() => {
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Mac OS X" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
