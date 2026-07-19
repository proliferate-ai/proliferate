import type {
  MouseEvent,
  PointerEvent,
  ReactElement,
  Ref,
} from "react";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { SessionTitleRenamePopover } from "#product/components/workspace/shell/tabs/SessionTitleRenamePopover";
import { ChromeWorkspaceTab } from "#product/components/workspace/shell/tabs/ChromeWorkspaceTab";
import { DelegatedAgentHoverCard } from "#product/components/workspace/shell/tabs/DelegatedAgentHoverCard";
import type { ManualChatGroupEditorAnchorRect } from "#product/components/workspace/shell/tabs/ManualChatGroupEditorPopover";
import { TabContextMenu } from "#product/components/workspace/shell/tabs/TabContextMenu";
import {
  getChatTabLabel,
  renderChatTabIcon,
  renderChatTabStatusBadge,
} from "#product/components/workspace/shell/tabs/tab-rendering";
import { useWorkspaceTabNativeContextMenu } from "#product/hooks/workspaces/ui/tabs/use-workspace-tab-native-context-menu";
import type {
  HeaderChatTabEntry,
} from "#product/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";
import {
  buildChatTabContextMenuItems,
  type WorkspaceTabContextMenuCommand,
} from "#product/lib/domain/workspaces/tabs/context-menu";

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
  canClose,
  canDismiss,
  onClose,
  onCloseOthers,
  onCloseRight,
  onDismiss,
  shortcutLabel,
  shortcutRevealVisible,
  stripIndex,
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
  canClose: boolean;
  canDismiss: boolean;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
  onDismiss: () => void;
  shortcutLabel: string | null;
  shortcutRevealVisible: boolean;
  /** Visual order among the strip's chat tabs; testid-only (data-chat-tab-index). */
  stripIndex?: number;
}) {
  const isReviewAgentChild = tab.isReviewAgentChild;
  const menuItems = buildChatTabContextMenuItems({
    canRename: !isReviewAgentChild,
    canFork: tab.canFork && !tab.isChild && !isReviewAgentChild,
    canClose,
    canDismiss: canDismiss && !isReviewAgentChild,
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
      label={getChatTabLabel(tab)}
      isChild={tab.isChild}
      groupColor={tab.groupColor}
      onSelect={onSelect}
      onSelectPointerDownCapture={onSelectPointerDownCapture}
      canClose={canClose}
      onClose={onClose}
      badge={renderChatTabStatusBadge(tab)}
      shortcutLabel={shortcutLabel}
      shortcutRevealVisible={shortcutRevealVisible}
      data-chat-tab={tab.id}
      data-chat-tab-id={tab.id}
      data-chat-tab-active={tab.isActive ? "true" : "false"}
      data-chat-tab-session-id={tab.id}
      data-chat-tab-harness={tab.agentKind}
      data-chat-tab-index={stripIndex}
      data-workspace-empty-chat={tab.isEmptyChat === true ? "true" : "false"}
    />
  );
  const renameTrigger = tab.delegatedAgent ? (
    <DelegatedAgentHoverCard agent={tab.delegatedAgent}>
      {tabElement}
    </DelegatedAgentHoverCard>
  ) : tabElement;

  return (
    <PopoverButton
      triggerMode="contextMenu"
      stopPropagation
      className={`w-52 ${POPOVER_SURFACE_CLASS}`}
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
            trigger={renameTrigger as unknown as ReactElement<{
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
