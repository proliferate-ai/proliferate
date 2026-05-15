import type {
  MouseEvent,
  PointerEvent,
} from "react";
import { ChatTabWithMenu } from "@/components/workspace/shell/tabs/ChatTabWithMenu";
import type { ManualChatGroupEditorAnchorRect } from "@/components/workspace/shell/tabs/ManualChatGroupEditorPopover";
import { useOpenCoworkCodingSession } from "@/hooks/cowork/workflows/use-open-cowork-coding-session";
import {
  isPrimaryMultiSelectClick,
  isPrimaryMultiSelectPointer,
} from "@/hooks/workspaces/tabs/use-header-tabs-multi-select";
import type { HeaderChatTabEntry } from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

interface HeaderChatTabProps {
  tab: HeaderChatTabEntry;
  rowDragProps?: { "data-tab-drag-row-id": string };
  width: number;
  position: number;
  dragOffset: number;
  isDragging: boolean;
  canDragTab: boolean;
  hideLeftDivider: boolean;
  hideRightDivider: boolean;
  renamingSessionId: string | null;
  multiSelectedSessionIds: ReadonlySet<string>;
  selectedTopLevelSessionIds: readonly string[];
  onPointerEnter: () => void;
  shouldSuppressClick: () => boolean;
  onRenameOpenChange: (sessionId: string, isOpen: boolean) => void;
  onStartRename: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => Promise<unknown>;
  onCreateGroup: (sessionIds: readonly string[]) => void;
  onContextMenuTarget: (
    sessionId: string,
    anchorRect: ManualChatGroupEditorAnchorRect,
  ) => void;
  onFork: (sessionId: string) => void;
  onPreview: (sessionId: string) => void;
  onActivate: (sessionId: string) => void;
  onSuppressSelect: () => void;
  onClose: (sessionId: string) => void;
  onCloseOthers: (sessionId: string) => void;
  onCloseRight: (sessionId: string) => void;
  onDismiss: (sessionId: string) => void;
  clearSelection: () => void;
  toggleSelection: (sessionId: string) => void;
  suppressNextSelectClick: (sessionId: string) => void;
  consumeSuppressedSelectClick: (sessionId: string) => boolean;
}

export function HeaderChatTab({
  tab,
  rowDragProps,
  width,
  position,
  dragOffset,
  isDragging,
  canDragTab,
  hideLeftDivider,
  hideRightDivider,
  renamingSessionId,
  multiSelectedSessionIds,
  selectedTopLevelSessionIds,
  onPointerEnter,
  shouldSuppressClick,
  onRenameOpenChange,
  onStartRename,
  onRename,
  onCreateGroup,
  onContextMenuTarget,
  onFork,
  onPreview,
  onActivate,
  onSuppressSelect,
  onClose,
  onCloseOthers,
  onCloseRight,
  onDismiss,
  clearSelection,
  toggleSelection,
  suppressNextSelectClick,
  consumeSuppressedSelectClick,
}: HeaderChatTabProps) {
  const openCoworkCodingSession = useOpenCoworkCodingSession();
  const canMultiSelect = !tab.isChild;
  const canCreateGroup = canMultiSelect
    && multiSelectedSessionIds.has(tab.id)
    && selectedTopLevelSessionIds.length >= 2;

  const activateTab = () => {
    clearSelection();
    if (tab.source === "cowork" && tab.workspaceId) {
      void openCoworkCodingSession({
        workspaceId: tab.workspaceId,
        sessionId: tab.id,
        parentSessionId: tab.parentSessionId,
        sessionLinkId: tab.sessionLinkId,
      });
      return;
    }
    onActivate(tab.id);
  };

  const handleSelectPointerDownCapture = (event: PointerEvent<HTMLButtonElement>) => {
    if (!canMultiSelect || !isPrimaryMultiSelectPointer(event)) {
      if (event.isPrimary && event.button === 0) {
        onPreview(tab.id);
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    suppressNextSelectClick(tab.id);
    toggleSelection(tab.id);
  };

  const handleSelect = (event: MouseEvent<HTMLButtonElement>) => {
    if (shouldSuppressClick()) {
      onSuppressSelect();
      return;
    }
    if (consumeSuppressedSelectClick(tab.id)) {
      event.preventDefault();
      return;
    }
    if (canMultiSelect && isPrimaryMultiSelectClick(event)) {
      event.preventDefault();
      toggleSelection(tab.id);
      return;
    }
    activateTab();
  };

  return (
    <div
      {...(rowDragProps ?? {})}
      onPointerEnter={onPointerEnter}
      className={`absolute bottom-0 h-7 app-region-no-drag ${
        isDragging
          ? "z-[20] cursor-grabbing opacity-80"
          : `${tab.isActive ? "z-[5]" : "z-[1] hover:z-[2]"} ${
            canDragTab ? "cursor-grab" : "cursor-default"
          } transition-transform duration-150`
      }`}
      style={{
        width,
        transform: `translate3d(${position + dragOffset}px, 0, 0)`,
      }}
    >
      <ChatTabWithMenu
        tab={tab}
        width={width}
        hideLeftDivider={hideLeftDivider}
        hideRightDivider={hideRightDivider}
        renaming={renamingSessionId === tab.id}
        onRenameOpenChange={(isOpen) => onRenameOpenChange(tab.id, isOpen)}
        onStartRename={() => onStartRename(tab.id)}
        onRename={(title) => onRename(tab.id, title)}
        isMultiSelected={!tab.isActive && multiSelectedSessionIds.has(tab.id)}
        canCreateGroup={canCreateGroup}
        onCreateGroup={() => onCreateGroup(selectedTopLevelSessionIds)}
        onFork={() => onFork(tab.id)}
        onSelectPointerDownCapture={handleSelectPointerDownCapture}
        onContextMenuTarget={(anchorRect) => onContextMenuTarget(tab.id, anchorRect)}
        onSelect={handleSelect}
        onClose={() => onClose(tab.id)}
        onCloseOthers={() => onCloseOthers(tab.id)}
        onCloseRight={() => onCloseRight(tab.id)}
        onDismiss={() => onDismiss(tab.id)}
      />
    </div>
  );
}
