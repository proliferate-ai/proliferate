import { FileTabWithMenu } from "@/components/workspace/shell/tabs/FileTabWithMenu";

interface HeaderViewerTabProps {
  rowDragProps: { "data-tab-drag-row-id": string };
  width: number;
  position: number;
  dragOffset: number;
  isDragging: boolean;
  path: string;
  label: string;
  isActive: boolean;
  isDirty: boolean;
  isDiff: boolean;
  isAllChanges: boolean;
  hideLeftDivider: boolean;
  hideRightDivider: boolean;
  onPointerEnter: () => void;
  shouldSuppressClick: () => boolean;
  onSelect: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
}

export function HeaderViewerTab({
  rowDragProps,
  width,
  position,
  dragOffset,
  isDragging,
  path,
  label,
  isActive,
  isDirty,
  isDiff,
  isAllChanges,
  hideLeftDivider,
  hideRightDivider,
  onPointerEnter,
  shouldSuppressClick,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseRight,
}: HeaderViewerTabProps) {
  return (
    <div
      {...rowDragProps}
      onPointerEnter={onPointerEnter}
      className={`absolute bottom-0 h-9 app-region-no-drag ${
        isDragging
          ? "z-[20] cursor-grabbing opacity-80"
          : `${isActive ? "z-[5]" : "z-[1] hover:z-[2]"} cursor-grab transition-transform duration-150`
      }`}
      style={{
        width,
        transform: `translate3d(${position + dragOffset}px, 0, 0)`,
      }}
    >
      <FileTabWithMenu
        path={path}
        label={label}
        isActive={isActive}
        isDirty={isDirty}
        isDiff={isDiff}
        isAllChanges={isAllChanges}
        width={width}
        hideLeftDivider={hideLeftDivider}
        hideRightDivider={hideRightDivider}
        onSelect={() => {
          if (shouldSuppressClick()) {
            return;
          }
          onSelect();
        }}
        onClose={onClose}
        onCloseOthers={onCloseOthers}
        onCloseRight={onCloseRight}
      />
    </div>
  );
}
