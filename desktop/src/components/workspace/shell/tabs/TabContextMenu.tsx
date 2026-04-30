import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash,
  X,
} from "@/components/ui/icons";
import { SHORTCUTS } from "@/config/shortcuts";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";
import type {
  WorkspaceTabContextMenuCommand,
  WorkspaceTabContextMenuItem,
} from "@/lib/domain/workspaces/tabs/context-menu";

export function TabContextMenu({
  items,
  onSelect,
}: {
  items: readonly WorkspaceTabContextMenuItem[];
  onSelect: (command: WorkspaceTabContextMenuCommand) => void;
}) {
  return (
    <div className="py-0.5">
      {items.map((item) => {
        if (item.kind === "separator") {
          return <div key={item.id} className="my-1 border-t border-border" />;
        }

        return (
          <PopoverMenuItem
            key={item.command}
            icon={renderTabContextMenuIcon(item.command)}
            label={item.label}
            trailing={item.shortcutKey ? (
              <span className="text-xs text-muted-foreground/70">
                {getShortcutDisplayLabel(SHORTCUTS[item.shortcutKey])}
              </span>
            ) : undefined}
            className={item.tone === "destructive" ? "text-destructive hover:text-destructive" : ""}
            onClick={() => onSelect(item.command)}
          />
        );
      })}
    </div>
  );
}

function renderTabContextMenuIcon(command: WorkspaceTabContextMenuCommand) {
  switch (command) {
    case "rename":
    case "rename-group":
      return <Pencil className="size-3.5" />;
    case "create-group":
      return <FolderPlus className="size-3.5" />;
    case "collapse-group":
      return <ChevronDown className="size-3.5" />;
    case "expand-group":
      return <ChevronRight className="size-3.5" />;
    case "change-group-color":
      return <FolderOpen className="size-3.5" />;
    case "ungroup":
      return <Folder className="size-3.5" />;
    case "close":
      return <X className="size-3.5" />;
    case "dismiss":
      return <Trash className="size-3.5" />;
    case "close-others":
    case "close-right":
      return null;
  }
}
