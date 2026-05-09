import type { ManualChatGroupEditorAnchorRect } from "@/components/workspace/shell/tabs/ManualChatGroupEditorPopover";
import { TabGroupPillWithMenu } from "@/components/workspace/shell/tabs/TabGroupPillWithMenu";
import type { ManualChatGroupId } from "@/lib/domain/workspaces/tabs/manual-groups";
import type { PillRow } from "@/lib/domain/workspaces/tabs/group-rows";

interface HeaderGroupPillTabProps {
  row: PillRow;
  rowDragProps?: { "data-tab-drag-row-id": string };
  width: number;
  position: number;
  dragOffset: number;
  isDragging: boolean;
  onToggle: (groupId: string) => void;
  onRenameManualGroup: (
    groupId: ManualChatGroupId,
    anchorRect: ManualChatGroupEditorAnchorRect,
  ) => void;
  onChangeManualGroupColor: (
    groupId: ManualChatGroupId,
    anchorRect: ManualChatGroupEditorAnchorRect,
  ) => void;
  onUngroupManualGroup: (groupId: ManualChatGroupId) => void;
  shouldSuppressClick: () => boolean;
}

export function HeaderGroupPillTab({
  row,
  rowDragProps,
  width,
  position,
  dragOffset,
  isDragging,
  onToggle,
  onRenameManualGroup,
  onChangeManualGroupColor,
  onUngroupManualGroup,
  shouldSuppressClick,
}: HeaderGroupPillTabProps) {
  return (
    <div
      {...(rowDragProps ?? {})}
      className={`absolute bottom-0 flex h-9 items-end pb-2 app-region-no-drag ${
        isDragging
          ? "z-[20] cursor-grabbing opacity-80"
          : `z-[3] transition-transform duration-150 hover:z-[4] ${
            row.groupKind === "subagent" ? "cursor-grab" : ""
          }`
      }`}
      style={{
        width,
        transform: `translate3d(${position + dragOffset}px, 0, 0)`,
      }}
    >
      <TabGroupPillWithMenu
        groupKind={row.groupKind}
        label={row.label}
        color={row.color}
        width={width}
        isCollapsed={row.isCollapsed}
        onToggle={() => {
          if (shouldSuppressClick()) {
            return;
          }
          onToggle(row.groupId);
        }}
        onRename={row.groupKind === "manual"
          ? (anchorRect) => onRenameManualGroup(row.manualGroupId, anchorRect)
          : undefined}
        onChangeColor={row.groupKind === "manual"
          ? (anchorRect) => onChangeManualGroupColor(row.manualGroupId, anchorRect)
          : undefined}
        onUngroup={row.groupKind === "manual"
          ? () => onUngroupManualGroup(row.manualGroupId)
          : undefined}
      />
    </div>
  );
}
