import { DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@proliferate/ui/kit/DropdownMenu";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  Fork,
  MoreHorizontal,
  Pencil,
  Trash,
} from "@proliferate/ui/icons";
import { SHORTCUTS } from "@/config/shortcuts/registry";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";

export interface WorkspaceActionsMenuSessionProps {
  canRename: boolean;
  canFork: boolean;
  canDismiss: boolean;
  onRename: () => void;
  onFork: () => void;
  onDismiss: () => void;
}

interface WorkspaceActionsMenuProps {
  session: WorkspaceActionsMenuSessionProps;
}

/**
 * The workspace three-dot menu: chat actions only (rename, fork, archive).
 * Git actions have moved to the dedicated GitInfoPopover in the header.
 */
export function WorkspaceActionsMenu({ session }: WorkspaceActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Chat actions"
          title="Chat actions"
          className="workspace-shell-icon-button app-region-no-drag shrink-0"
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          disabled={!session.canRename}
          onSelect={session.onRename}
        >
          <Pencil className="size-4" />
          Rename chat
          <DropdownMenuShortcut>
            {getShortcutDisplayLabel(SHORTCUTS.renameSession)}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!session.canFork}
          onSelect={session.onFork}
        >
          <Fork className="size-4" />
          Fork chat
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={!session.canDismiss}
          onSelect={session.onDismiss}
        >
          <Trash className="size-4" />
          Archive chat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
