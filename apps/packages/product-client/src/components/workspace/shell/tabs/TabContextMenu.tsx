import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Fork,
  Pencil,
  Trash,
  X,
} from "@proliferate/ui/icons";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";
import type {
  WorkspaceTabContextMenuCommand,
  WorkspaceTabContextMenuItem,
} from "#product/lib/domain/workspaces/tabs/context-menu";

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
          return <div key={item.id} className="mx-2.5 my-1 h-px bg-border" />;
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
      return <Pencil className="icon-paired" />;
    case "create-group":
      return <FolderPlus className="icon-paired" />;
    case "fork":
      return <Fork className="icon-paired" />;
    case "collapse-group":
      return <ChevronDown className="icon-paired" />;
    case "expand-group":
      return <ChevronRight className="icon-paired" />;
    case "change-group-color":
      return <FolderOpen className="icon-paired" />;
    case "ungroup":
      return <Folder className="icon-paired" />;
    case "close":
      return <X className="icon-paired" />;
    case "dismiss":
      return <Trash className="icon-paired" />;
    case "close-others":
    case "close-right":
      return null;
  }
}
