import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildShortcutSections,
  type ShortcutSectionView,
} from "@/lib/domain/shortcuts/shortcut-sections";

function stubMacPlatform() {
  vi.stubGlobal("navigator", {
    platform: "MacIntel",
    userAgent: "Mac OS X",
  });
}

function findEntry(section: ShortcutSectionView | undefined, command: string) {
  return section?.entries.find((entry) => entry.command === command);
}

describe("buildShortcutSections", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds every group and merges multi-binding entries into one row", () => {
    stubMacPlatform();

    const sections = buildShortcutSections("");

    expect(sections.map((section) => section.title)).toEqual([
      "App",
      "Workspaces",
      "Tabs",
      "Current Workspace",
      "Composer",
    ]);

    const tabs = sections.find((section) => section.title === "Tabs");
    expect(findEntry(tabs, "Previous tab")?.labels).toEqual(["⌘⇧[", "⌘⌥←"]);
    expect(findEntry(tabs, "Close other tabs")?.labels).toEqual(["⌘⌥O", "⌘⇧O"]);
    expect(findEntry(tabs, "New chat")?.labels).toEqual(["⌘T"]);
  });

  it("matches by binding label and keeps only the matching alias", () => {
    stubMacPlatform();

    const sections = buildShortcutSections("⌘⌥←");

    expect(sections).toEqual([
      {
        title: "Tabs",
        entries: [
          {
            id: "workspace.previous-tab:Previous tab",
            command: "Previous tab",
            labels: ["⌘⌥←"],
          },
        ],
      },
    ]);
    expect(findEntry(sections[0], "Next tab")).toBeUndefined();
  });

  it("matches by command text", () => {
    stubMacPlatform();

    const sections = buildShortcutSections("terminal");

    expect(sections.map((section) => section.title)).toEqual([
      "Current Workspace",
    ]);
    expect(findEntry(sections[0], "Open terminal")?.labels).toEqual(["⌘J"]);
    expect(findEntry(sections[0], "New chat")).toBeUndefined();
  });

  it("keeps the whole group when the query matches the group title", () => {
    stubMacPlatform();

    const unfiltered = buildShortcutSections("")
      .find((section) => section.title === "Tabs");
    const filtered = buildShortcutSections("tabs")
      .find((section) => section.title === "Tabs");

    expect(filtered).toEqual(unfiltered);
    expect(findEntry(filtered, "Previous tab")).toBeTruthy();
    expect(findEntry(filtered, "Next tab")).toBeTruthy();
  });

  it("returns no sections for a query nothing matches", () => {
    stubMacPlatform();

    expect(buildShortcutSections("zzz-no-such-shortcut")).toEqual([]);
  });
});
