import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { ChromeWorkspaceTab } from "@/components/workspace/shell/tabs/ChromeWorkspaceTab";
import { TabContextMenu } from "@/components/workspace/shell/tabs/TabContextMenu";
import { useWorkspaceTabNativeContextMenu } from "@/hooks/workspaces/tabs/use-workspace-tab-native-context-menu";
import {
  FILE_TAB_CONTEXT_MENU_ITEMS,
  type WorkspaceTabContextMenuCommand,
} from "@/lib/domain/workspaces/tabs/context-menu";

export function FileTabWithMenu({
  path,
  isActive,
  isDirty,
  isDiff,
  width,
  hideLeftDivider,
  hideRightDivider,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseRight,
}: {
  path: string;
  isActive: boolean;
  isDirty: boolean;
  isDiff: boolean;
  width: number;
  hideLeftDivider: boolean;
  hideRightDivider: boolean;
  onSelect: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
}) {
  const basename = path.split("/").pop() ?? path;
  const { onContextMenuCapture } = useWorkspaceTabNativeContextMenu({
    items: FILE_TAB_CONTEXT_MENU_ITEMS,
    onSelect: handleContextMenuCommand,
  });

  function handleContextMenuCommand(command: WorkspaceTabContextMenuCommand) {
    switch (command) {
      case "close":
        onClose();
        return;
      case "close-others":
        onCloseOthers();
        return;
      case "close-right":
        onCloseRight();
        return;
      case "create-group":
      case "dismiss":
      case "collapse-group":
      case "expand-group":
      case "rename-group":
      case "change-group-color":
      case "ungroup":
      case "rename":
        return;
    }
  }

  return (
    <PopoverButton
      triggerMode="contextMenu"
      stopPropagation
      className="w-52 rounded-lg border border-border bg-popover p-1 shadow-floating"
      trigger={(
        <span
          className="inline-flex min-w-0 shrink-0 app-region-no-drag"
          onContextMenuCapture={onContextMenuCapture}
        >
          <ChromeWorkspaceTab
            isActive={isActive}
            width={width}
            hideLeftDivider={hideLeftDivider}
            hideRightDivider={hideRightDivider}
            icon={(
              <FileTreeEntryIcon
                name={basename}
                path={path}
                kind="file"
                className="size-3 shrink-0"
              />
            )}
            label={basename}
            onSelect={onSelect}
            onClose={onClose}
            badge={(
              <>
                {isDiff && (
                  <span className="shrink-0 text-xs font-medium text-git-green">DIFF</span>
                )}
                {isDirty && (
                  <span className="size-1.5 shrink-0 rounded-full bg-foreground/50" />
                )}
              </>
            )}
          />
        </span>
      )}
    >
      {(close) => (
        <TabContextMenu
          items={FILE_TAB_CONTEXT_MENU_ITEMS}
          onSelect={(command) => {
            close();
            handleContextMenuCommand(command);
          }}
        />
      )}
    </PopoverButton>
  );
}
