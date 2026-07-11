import { useCallback, useRef, useState } from "react";
import {
  DropdownMenu,
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
import { useWorkspaceActionsNativeMenu } from "@/hooks/workspaces/ui/use-workspace-actions-native-menu";

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
 * Chat-only overflow actions. In Tauri the click opens an OS-native menu;
 * Radix remains the browser/failure fallback used by tests and playgrounds.
 */
export function WorkspaceActionsMenu({ session }: WorkspaceActionsMenuProps) {
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { showNativeMenu } = useWorkspaceActionsNativeMenu(session);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setFallbackOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    void showNativeMenu(rect ? { x: rect.left, y: rect.bottom } : undefined).then((shown) => {
      if (!shown) setFallbackOpen(true);
    });
  }, [showNativeMenu]);

  return (
    <DropdownMenu open={fallbackOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Chat actions"
          title="Chat actions"
          className="workspace-shell-icon-button workspace-shell-icon-button--hover-rim app-region-no-drag shrink-0"
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
