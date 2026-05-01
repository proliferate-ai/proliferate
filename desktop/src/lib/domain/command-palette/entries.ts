export type CommandPaletteGroupId = "files" | "workspace" | "tabs" | "app";

export interface CommandPaletteEntry {
  id: string;
  group: CommandPaletteGroupId;
  label: string;
  detail?: string | null;
  keywords?: readonly string[];
  shortcut?: string | null;
  icon?: CommandPaletteIconId;
  disabledReason?: string | null;
  value: string;
  execute: () => void;
}

export type CommandPaletteIconId =
  | "chat"
  | "chat-plus"
  | "cloud-plus"
  | "command"
  | "folder-plus"
  | "git-branch"
  | "panel-bottom"
  | "pencil"
  | "play"
  | "rotate-ccw"
  | "settings"
  | "terminal"
  | "arrow-left"
  | "arrow-right";

export interface CommandPaletteGroup {
  id: CommandPaletteGroupId;
  label: string;
  entries: CommandPaletteEntry[];
}

const GROUP_ORDER: CommandPaletteGroupId[] = ["files", "workspace", "tabs", "app"];
const GROUP_LABELS: Record<CommandPaletteGroupId, string> = {
  files: "Files",
  workspace: "Workspace",
  tabs: "Tabs",
  app: "App",
};

export function commandPaletteFileValue(index: number): string {
  return `file:${index}`;
}

export function commandPaletteCommandValue(id: string): string {
  return `command:${id}`;
}

export function splitFilePath(filePath: string): {
  name: string;
  parent: string;
} {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return { name: "Untitled", parent: "" };
  }
  const parts = trimmed.split("/").filter(Boolean);
  const name = parts.length > 0 ? parts[parts.length - 1] : trimmed;
  return {
    name,
    parent: parts.slice(0, -1).join("/"),
  };
}

export function filterCommandPaletteEntries(
  entries: readonly CommandPaletteEntry[],
  query: string,
): CommandPaletteEntry[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return [...entries];
  }
  return entries.filter((entry) => {
    const haystack = [
      entry.label,
      entry.detail ?? "",
      entry.shortcut ?? "",
      ...(entry.keywords ?? []),
    ].join(" ").toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

export function groupCommandPaletteEntries(
  entries: readonly CommandPaletteEntry[],
): CommandPaletteGroup[] {
  return GROUP_ORDER.map((groupId) => ({
    id: groupId,
    label: GROUP_LABELS[groupId],
    entries: entries.filter((entry) => entry.group === groupId),
  })).filter((group) => group.entries.length > 0);
}
