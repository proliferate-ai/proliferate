import { describe, expect, it, vi } from "vitest";
import {
  commandPaletteCommandValue,
  commandPaletteFileValue,
  filterCommandPaletteEntries,
  groupCommandPaletteEntries,
  splitFilePath,
  type CommandPaletteEntry,
} from "@/lib/domain/command-palette/entries";

const execute = vi.fn();

function entry(overrides: Partial<CommandPaletteEntry>): CommandPaletteEntry {
  return {
    id: overrides.id ?? "entry",
    group: overrides.group ?? "workspace",
    label: overrides.label ?? "Entry",
    value: overrides.value ?? commandPaletteCommandValue(overrides.id ?? "entry"),
    execute,
    ...overrides,
  };
}

describe("command palette entries", () => {
  it("uses opaque values for file and command identities", () => {
    expect(commandPaletteFileValue(2)).toBe("file:2");
    expect(commandPaletteFileValue(2)).not.toContain("/Users/pablo/project/file.ts");
    expect(commandPaletteCommandValue("workspace.focus-chat")).toBe(
      "command:workspace.focus-chat",
    );
  });

  it("splits file paths into display name and parent path", () => {
    expect(splitFilePath("/repo/src/App.tsx")).toEqual({
      name: "App.tsx",
      parent: "repo/src",
    });
    expect(splitFilePath("")).toEqual({ name: "Untitled", parent: "" });
  });

  it("filters by whitespace tokens while preserving configured order", () => {
    const entries = [
      entry({
        id: "focus",
        label: "Focus Chat",
        keywords: ["composer", "input"],
      }),
      entry({
        id: "terminal",
        label: "Show Terminal",
        shortcut: "Cmd+J",
      }),
      entry({
        id: "settings",
        label: "Repository Settings",
        keywords: ["repo", "preferences"],
      }),
    ];

    expect(filterCommandPaletteEntries(entries, "chat input").map((item) => item.id))
      .toEqual(["focus"]);
    expect(filterCommandPaletteEntries(entries, "cmd+j").map((item) => item.id))
      .toEqual(["terminal"]);
    expect(filterCommandPaletteEntries(entries, "repo set").map((item) => item.id))
      .toEqual(["settings"]);
    expect(filterCommandPaletteEntries(entries, "   ").map((item) => item.id))
      .toEqual(["focus", "terminal", "settings"]);
  });

  it("groups entries by the configured group order", () => {
    const groups = groupCommandPaletteEntries([
      entry({ id: "settings", group: "app", label: "Open Settings" }),
      entry({ id: "file", group: "files", label: "App.tsx" }),
      entry({ id: "tab", group: "tabs", label: "Next Tab" }),
    ]);

    expect(groups.map((group) => [group.id, group.entries.map((item) => item.id)]))
      .toEqual([
        ["files", ["file"]],
        ["tabs", ["tab"]],
        ["app", ["settings"]],
      ]);
  });
});
