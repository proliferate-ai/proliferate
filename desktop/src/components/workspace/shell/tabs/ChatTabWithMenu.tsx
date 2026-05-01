import type {
  MouseEvent,
  PointerEvent,
  ReactElement,
  Ref,
} from "react";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { SessionTitleRenamePopover } from "@/components/workspace/shell/SessionTitleRenamePopover";
import { ChromeWorkspaceTab } from "@/components/workspace/shell/tabs/ChromeWorkspaceTab";
import type { ManualChatGroupEditorAnchorRect } from "@/components/workspace/shell/tabs/ManualChatGroupEditorPopover";
import { TabContextMenu } from "@/components/workspace/shell/tabs/TabContextMenu";
import {
  renderChatTabIcon,
  renderChatTabStatusBadge,
} from "@/components/workspace/shell/tabs/tab-rendering";
import { useWorkspaceTabNativeContextMenu } from "@/hooks/workspaces/tabs/use-workspace-tab-native-context-menu";
import type { HeaderChatTabEntry } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";
import {
  buildChatTabContextMenuItems,
  type WorkspaceTabContextMenuCommand,
} from "@/lib/domain/workspaces/tabs/context-menu";

export function ChatTabWithMenu({
  tab,
  width,
  hideLeftDivider,
  hideRightDivider,
  renaming,
  onRenameOpenChange,
  onStartRename,
  onRename,
  onSelect,
  onSelectPointerDownCapture,
  isMultiSelected = false,
  canCreateGroup = false,
  onCreateGroup,
  onContextMenuTarget,
  onFork,
  onClose,
  onCloseOthers,
  onCloseRight,
  onDismiss,
}: {
  tab: HeaderChatTabEntry;
  width: number;
  hideLeftDivider?: boolean;
  hideRightDivider?: boolean;
  renaming: boolean;
  onRenameOpenChange: (open: boolean) => void;
  onStartRename: () => void;
  onRename: (title: string) => Promise<unknown>;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  onSelectPointerDownCapture?: (event: PointerEvent<HTMLButtonElement>) => void;
  isMultiSelected?: boolean;
  canCreateGroup?: boolean;
  onCreateGroup?: () => void;
  onContextMenuTarget?: (anchorRect: ManualChatGroupEditorAnchorRect) => void;
  onFork?: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
  onDismiss: () => void;
}) {
  const isReviewAgentChild = tab.isReviewAgentChild;
  const menuItems = buildChatTabContextMenuItems({
    canRename: !isReviewAgentChild,
    canFork: tab.canFork && !tab.isChild && !isReviewAgentChild,
    canDismiss: !isReviewAgentChild,
    canCreateGroup: !isReviewAgentChild && canCreateGroup,
    isChild: tab.isChild,
  });
  const { onContextMenuCapture } = useWorkspaceTabNativeContextMenu({
    items: menuItems,
    onSelect: handleContextMenuCommand,
  });

  function handleContextMenuCommand(command: WorkspaceTabContextMenuCommand) {
    switch (command) {
      case "rename":
        onStartRename();
        return;
      case "create-group":
        onCreateGroup?.();
        return;
      case "fork":
        onFork?.();
        return;
      case "close":
        onClose();
        return;
      case "close-others":
        onCloseOthers();
        return;
      case "close-right":
        onCloseRight();
        return;
      case "dismiss":
        onDismiss();
        return;
      case "collapse-group":
      case "expand-group":
      case "rename-group":
      case "change-group-color":
      case "ungroup":
        return;
    }
  }

  const tabElement = (
    <ChromeWorkspaceTab
      isActive={tab.isActive}
      isMultiSelected={isMultiSelected}
      width={width}
      hideLeftDivider={hideLeftDivider}
      hideRightDivider={hideRightDivider}
      icon={renderChatTabIcon(tab)}
      label={tab.title}
      isChild={tab.isChild}
      groupColor={tab.groupColor}
      onSelect={onSelect}
      onSelectPointerDownCapture={onSelectPointerDownCapture}
      onClose={onClose}
      badge={renderChatTabStatusBadge(tab)}
    />
  );

  return (
    <PopoverButton
      triggerMode="contextMenu"
      stopPropagation
      className="w-52 rounded-lg border border-border bg-popover p-1 shadow-floating"
      trigger={(
        <span
          className="inline-flex min-w-0 shrink-0 app-region-no-drag"
          onContextMenuCapture={(event) => {
            onContextMenuTarget?.(rectToAnchor(event.currentTarget.getBoundingClientRect()));
            onContextMenuCapture(event);
          }}
        >
          <SessionTitleRenamePopover
            currentTitle={tab.title}
            onRename={onRename}
            externalOpen={renaming}
            onOpenChange={onRenameOpenChange}
            triggerMode="doubleClick"
            trigger={tabElement as unknown as ReactElement<{
              onClick?: (...args: unknown[]) => void;
              onDoubleClick?: (...args: unknown[]) => void;
              onContextMenu?: (...args: unknown[]) => void;
              ref?: Ref<HTMLElement>;
            }>}
          />
        </span>
      )}
    >
      {(close) => (
        <TabContextMenu
          items={menuItems}
          onSelect={(command) => {
            close();
            handleContextMenuCommand(command);
          }}
        />
      )}
    </PopoverButton>
  );
}

function rectToAnchor(rect: DOMRect): ManualChatGroupEditorAnchorRect {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}
