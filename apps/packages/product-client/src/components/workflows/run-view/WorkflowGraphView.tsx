import { Fragment } from "react";

import type { WorkflowGraphSlotVM } from "#product/domain/workflows/run-view-model";
import { ChevronDown } from "#product/primitives/icons/core";
import { WorkflowGraphNodeCard } from "#product/components/workflows/run-view/WorkflowGraphNodeCard";

export interface WorkflowGraphViewProps {
  slots: WorkflowGraphSlotVM[];
  needsInputNodeRowIds: ReadonlySet<string>;
  busy: boolean;
  onFocusSession(nodeRowId: string): void;
  onApprove(nodeRowId: string): void;
  onFailRedo(nodeRowId: string, prompt?: string): void;
  onFlipType(nodeRowId: string, nodeType: "agent" | "human_in_loop"): void;
  onAddAdhoc(anchorNodeRowId: string, prompt: string): void;
}

/**
 * The run's chain drawn as a graph rather than a flat stack: consecutive
 * chain slots are joined by a drawn edge, and a slot's ad hoc side nodes
 * hang off a branch rail under their anchor, so the pane reads as flow —
 * this slot feeds the next, that side node belongs to this one — instead of
 * a list of sibling cards.
 *
 * Pure layout. Retries stay inside their slot (a second attempt is the same
 * chain position, not a chain advance, so no edge is drawn between them),
 * every card keeps its own controls, and the callbacks pass through
 * untouched.
 */
export function WorkflowGraphView({
  slots,
  needsInputNodeRowIds,
  busy,
  onFocusSession,
  onApprove,
  onFailRedo,
  onFlipType,
  onAddAdhoc,
}: WorkflowGraphViewProps) {
  const cardHandlers = { onFocusSession, onApprove, onFailRedo, onFlipType, onAddAdhoc };
  return (
    <div className="flex flex-col">
      {slots.map((slot, slotIndex) => (
        <Fragment key={slot.chainIndex}>
          {slotIndex > 0 ? <WorkflowGraphEdge /> : null}
          <div className="flex flex-col gap-1.5">
            {slot.attempts.map((vm) => (
              <WorkflowGraphNodeCard
                key={vm.node.id}
                vm={vm}
                needsInput={needsInputNodeRowIds.has(vm.node.id)}
                busy={busy}
                {...cardHandlers}
              />
            ))}
            {slot.adhoc.length > 0 ? (
              <div className="ml-6 flex flex-col gap-1.5 border-l border-border pl-3">
                {slot.adhoc.map((vm) => (
                  <WorkflowGraphNodeCard
                    key={vm.node.id}
                    vm={vm}
                    secondary
                    needsInput={needsInputNodeRowIds.has(vm.node.id)}
                    busy={busy}
                    {...cardHandlers}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * The edge between two consecutive chain slots: a centered hairline segment
 * (the `w-px bg-border` idiom `TranscriptTurnChrome` draws) flowing into a
 * small arrowhead. Decorative only, hence `aria-hidden` — order is already
 * announced by each card's chain-index title. The arrowhead sits at
 * `icon-tight`, the smallest tier whose scaled stroke still covers a full
 * device pixel on 1x displays, and takes the border ink the separator-glyph
 * call sites already use, so the whole edge reads as one drawn line.
 */
function WorkflowGraphEdge() {
  return (
    <div aria-hidden className="flex flex-col items-center self-center py-0.5">
      <span className="h-3 w-px bg-border" />
      <ChevronDown className="icon-tight -mt-1.5 text-border-heavy" />
    </div>
  );
}
