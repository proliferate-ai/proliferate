import type { ReactNode } from "react";
import type { WorkflowAgentNode, WorkflowParallelGroup } from "@proliferate/product-domain/workflows/definition";
import type { SpineAddress } from "@proliferate/product-domain/workflows/spine-editing";
import { Button } from "@proliferate/ui/primitives/Button";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { MoreHorizontal } from "@proliferate/ui/icons";

interface DragLane {
  spineIndex: number;
  laneIndex: number;
}

export interface WorkflowParallelGroupBlockProps {
  entry: WorkflowParallelGroup;
  spineIndex: number;
  /** Whether this is the last spine entry (disables "Move down"). */
  isLastSpineEntry: boolean;
  dragLane: DragLane | null;
  onDragLaneChange: (lane: DragLane | null) => void;
  onReorderSpineEntry: (from: number, to: number) => void;
  onAddLane: (spineIndex: number) => void;
  onReorderLane: (spineIndex: number, from: number, to: number) => void;
  onRemoveLane: (spineIndex: number, lane: string) => void;
  renderAgentBlock: (node: WorkflowAgentNode, address: SpineAddress, menu: ReactNode) => ReactNode;
  agentMenu: (
    address: SpineAddress,
    opts: {
      canMoveUp: boolean;
      canMoveDown: boolean;
      onMoveUp: () => void;
      onMoveDown: () => void;
      onDelete?: () => void;
      onAddParallel: () => void;
    },
  ) => ReactNode;
}

/** One "Run together" spine entry: the group header (add-lane/move menu) plus
 * its lanes rendered side-by-side, each an agent block card. */
export function WorkflowParallelGroupBlock({
  entry,
  spineIndex,
  isLastSpineEntry,
  dragLane,
  onDragLaneChange,
  onReorderSpineEntry,
  onAddLane,
  onReorderLane,
  onRemoveLane,
  renderAgentBlock,
  agentMenu,
}: WorkflowParallelGroupBlockProps) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface-elevated-secondary/20 transition-colors hover:border-border-heavy">
      <div className="flex min-w-0 items-center gap-2 px-3.5 py-2">
        <span className="text-sm font-medium text-foreground">Run together</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          continue once all finish, even if one fails
        </span>
        <span className="min-w-0 flex-1" />
        <PopoverButton
          stopPropagation
          align="end"
          side="bottom"
          className={`w-48 ${POPOVER_SURFACE_CLASS}`}
          trigger={(
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              aria-label="Group actions"
              className="shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-surface-elevated-secondary hover:text-muted-foreground"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          )}
        >
          {(close) => (
            <div className="p-1">
              <PopoverMenuItem
                density="compact"
                label="Add parallel agent"
                onClick={() => { close(); onAddLane(spineIndex); }}
              />
              <PopoverMenuItem
                density="compact"
                label="Move up"
                disabled={spineIndex <= 0}
                onClick={() => { close(); onReorderSpineEntry(spineIndex, spineIndex - 1); }}
              />
              <PopoverMenuItem
                density="compact"
                label="Move down"
                disabled={isLastSpineEntry}
                onClick={() => { close(); onReorderSpineEntry(spineIndex, spineIndex + 1); }}
              />
            </div>
          )}
        </PopoverButton>
      </div>
      <div className="flex gap-2 px-2 pb-2">
        {entry.parallel.map((laneNode, laneIndex) => {
          const address: SpineAddress = { spineIndex, lane: laneNode.slot };
          return (
            <div
              key={laneNode.slot}
              className="flex min-w-[240px] flex-1 flex-col"
              draggable
              onDragStart={() => onDragLaneChange({ spineIndex, laneIndex })}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragLane !== null && dragLane.spineIndex === spineIndex) {
                  onReorderLane(spineIndex, dragLane.laneIndex, laneIndex);
                }
                onDragLaneChange(null);
              }}
            >
              {renderAgentBlock(laneNode, address, agentMenu(address, {
                canMoveUp: laneIndex > 0,
                canMoveDown: laneIndex < entry.parallel.length - 1,
                onMoveUp: () => onReorderLane(spineIndex, laneIndex, laneIndex - 1),
                onMoveDown: () => onReorderLane(spineIndex, laneIndex, laneIndex + 1),
                onDelete: () => onRemoveLane(spineIndex, laneNode.slot),
                onAddParallel: () => onAddLane(spineIndex),
              }))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
