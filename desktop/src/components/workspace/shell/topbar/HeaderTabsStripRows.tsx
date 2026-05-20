import type { ManualChatGroupEditorAnchorRect } from "@/components/workspace/shell/tabs/ManualChatGroupEditorPopover";
import { HeaderChatTab } from "@/components/workspace/shell/topbar/HeaderChatTab";
import { HeaderGroupPillTab } from "@/components/workspace/shell/topbar/HeaderGroupPillTab";
import type {
  HeaderWorkspaceShellStripRow,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";
import { getShellDragRowId } from "@/hooks/workspaces/tabs/use-header-tabs-layout";
import {
  TAB_GROUP_PILL_WIDTH,
} from "@/lib/domain/workspaces/tabs/chrome-layout";
import type { ManualChatGroupId } from "@/lib/domain/workspaces/tabs/manual-groups";
import { SHORTCUTS } from "@/config/shortcuts";
import { buildShortcutRangeLabelById } from "@/lib/domain/shortcuts/presentation";

interface HeaderTabsDragControls {
  getRowDragProps: (rowId: string) => { "data-tab-drag-row-id": string };
  isDraggingRow: (rowId: string) => boolean;
  getRowDragOffset: (rowId: string) => number;
  shouldSuppressClick: (rowId: string) => boolean;
}

interface HeaderTabsStripRowsProps {
  shellRows: HeaderWorkspaceShellStripRow[];
  widths: number[];
  positions: number[];
  shellDrag: HeaderTabsDragControls;
  renamingSessionId: string | null;
  urgentHighlightedChatSessionId: string | null;
  multiSelectedSessionIds: ReadonlySet<string>;
  selectedTopLevelSessionIds: readonly string[];
  onHeaderTabHover: () => void;
  onToggleGroup: (groupId: string) => void;
  onRenameManualGroup: (
    groupId: ManualChatGroupId,
    anchorRect: ManualChatGroupEditorAnchorRect,
  ) => void;
  onChangeManualGroupColor: (
    groupId: ManualChatGroupId,
    anchorRect: ManualChatGroupEditorAnchorRect,
  ) => void;
  onUngroupManualGroup: (groupId: ManualChatGroupId) => void;
  onRenameOpenChange: (sessionId: string, isOpen: boolean) => void;
  onStartRename: (sessionId: string) => void;
  onRenameChatTab: (sessionId: string, title: string) => Promise<unknown>;
  onCreateGroup: (sessionIds: readonly string[]) => void;
  onChatContextMenuTarget: (
    sessionId: string,
    anchorRect: ManualChatGroupEditorAnchorRect,
  ) => void;
  onForkChatTab: (sessionId: string) => void;
  onPreviewChatTab: (sessionId: string) => void;
  onActivateChatTab: (sessionId: string) => void;
  onSuppressChatTabSelect: () => void;
  onCloseChatTab: (sessionId: string) => void;
  onCloseOtherChatTabs: (sessionId: string) => void;
  onCloseChatTabsToRight: (sessionId: string) => void;
  onDismissChatSession: (sessionId: string) => void;
  shortcutRevealVisible: boolean;
  clearSelection: () => void;
  toggleSelection: (sessionId: string) => void;
  suppressNextSelectClick: (sessionId: string) => void;
  consumeSuppressedSelectClick: (sessionId: string) => boolean;
}

export function HeaderTabsStripRows({
  shellRows,
  widths,
  positions,
  shellDrag,
  renamingSessionId,
  urgentHighlightedChatSessionId,
  multiSelectedSessionIds,
  selectedTopLevelSessionIds,
  onHeaderTabHover,
  onToggleGroup,
  onRenameManualGroup,
  onChangeManualGroupColor,
  onUngroupManualGroup,
  onRenameOpenChange,
  onStartRename,
  onRenameChatTab,
  onCreateGroup,
  onChatContextMenuTarget,
  onForkChatTab,
  onPreviewChatTab,
  onActivateChatTab,
  onSuppressChatTabSelect,
  onCloseChatTab,
  onCloseOtherChatTabs,
  onCloseChatTabsToRight,
  onDismissChatSession,
  shortcutRevealVisible,
  clearSelection,
  toggleSelection,
  suppressNextSelectClick,
  consumeSuppressedSelectClick,
}: HeaderTabsStripRowsProps) {
  const shortcutLabelBySessionId = buildShortcutRangeLabelById(
    shellRows.flatMap((shellRow) =>
      shellRow.kind === "chat" && shellRow.row.kind === "tab"
        ? [shellRow.row.tab.id]
        : []
    ),
    SHORTCUTS.tabByIndex,
  );

  return (
    <>
      {shellRows.map((shellRow, index) => {
        const rowKind = shellRow.kind === "chat" && shellRow.row.kind === "pill" ? "pill" : "tab";
        const width = widths[index] ?? (rowKind === "pill" ? TAB_GROUP_PILL_WIDTH : 160);
        const position = positions[index] ?? 0;
        const rowId = getShellDragRowId(shellRow);
        const isDragging = shellDrag.isDraggingRow(rowId);
        const dragOffset = shellDrag.getRowDragOffset(rowId);
        const shouldSuppressClick = () => shellDrag.shouldSuppressClick(rowId);

        if (shellRow.kind === "viewer") {
          return null;
        }

        const row = shellRow.row;
        if (row.kind === "pill") {
          return (
            <HeaderGroupPillTab
              key={`pill-${row.groupId}`}
              row={row}
              rowDragProps={row.groupKind === "subagent"
                ? shellDrag.getRowDragProps(rowId)
                : undefined}
              width={width}
              position={position}
              dragOffset={dragOffset}
              isDragging={isDragging}
              shouldSuppressClick={shouldSuppressClick}
              onToggle={onToggleGroup}
              onRenameManualGroup={onRenameManualGroup}
              onChangeManualGroupColor={onChangeManualGroupColor}
              onUngroupManualGroup={onUngroupManualGroup}
            />
          );
        }

        const shortcutLabel = shortcutLabelBySessionId.get(row.tab.id) ?? null;
        const tab = urgentHighlightedChatSessionId
          ? {
            ...row.tab,
            isActive: row.tab.id === urgentHighlightedChatSessionId,
          }
          : row.tab;
        const previousShellRow = shellRows[index - 1];
        const nextShellRow = shellRows[index + 1];
        const previousIsChatTab =
          previousShellRow?.kind === "chat" && previousShellRow.row.kind === "tab";
        const nextIsChatTab =
          nextShellRow?.kind === "chat" && nextShellRow.row.kind === "tab";
        const canDragTab = !tab.isReviewAgentChild;

        return (
          <HeaderChatTab
            key={tab.id}
            tab={tab}
            rowDragProps={canDragTab ? shellDrag.getRowDragProps(rowId) : undefined}
            width={width}
            position={position}
            dragOffset={dragOffset}
            isDragging={isDragging}
            canDragTab={canDragTab}
            hideLeftDivider={!previousIsChatTab}
            hideRightDivider={!nextIsChatTab}
            renamingSessionId={renamingSessionId}
            multiSelectedSessionIds={multiSelectedSessionIds}
            selectedTopLevelSessionIds={selectedTopLevelSessionIds}
            onPointerEnter={onHeaderTabHover}
            shouldSuppressClick={shouldSuppressClick}
            onRenameOpenChange={onRenameOpenChange}
            onStartRename={onStartRename}
            onRename={onRenameChatTab}
            onCreateGroup={onCreateGroup}
            onContextMenuTarget={onChatContextMenuTarget}
            onFork={onForkChatTab}
            onPreview={onPreviewChatTab}
            onActivate={onActivateChatTab}
            onSuppressSelect={onSuppressChatTabSelect}
            onClose={onCloseChatTab}
            onCloseOthers={onCloseOtherChatTabs}
            onCloseRight={onCloseChatTabsToRight}
            onDismiss={onDismissChatSession}
            shortcutLabel={shortcutLabel}
            shortcutRevealVisible={shortcutRevealVisible}
            clearSelection={clearSelection}
            toggleSelection={toggleSelection}
            suppressNextSelectClick={suppressNextSelectClick}
            consumeSuppressedSelectClick={consumeSuppressedSelectClick}
          />
        );
      })}
    </>
  );
}
