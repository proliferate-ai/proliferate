import { Fragment } from "react";

import type {
  WorkflowGraphNodeVM,
  WorkflowGraphSlotVM,
} from "#product/domain/workflows/run-view-model";
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
 * chain slots are joined by a drawn edge, and every ad hoc side node hangs
 * off a branch rail directly under the attempt it anchors to, so the pane
 * reads as flow — this slot feeds the next, that side node belongs to this
 * attempt — instead of a list of sibling cards.
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
  const cardProps = {
    needsInputNodeRowIds,
    busy,
    onFocusSession,
    onApprove,
    onFailRedo,
    onFlipType,
    onAddAdhoc,
  };
  return (
    <div className="flex flex-col">
      {slots.map((slot, slotIndex) => {
        const attemptIds = new Set(slot.attempts.map((vm) => vm.node.id));
        // A side node's anchor is normally one of this slot's attempt rows; a
        // projection can still hand back an anchor the slot does not contain,
        // and those side nodes render on a trailing rail rather than vanish.
        const orphaned = slot.adhoc.filter(
          (vm) => vm.node.anchorNodeRowId === null || !attemptIds.has(vm.node.anchorNodeRowId),
        );
        return (
          <Fragment key={slot.chainIndex}>
            {slotIndex > 0 ? <WorkflowGraphEdge /> : null}
            <div className="flex flex-col gap-1.5">
              {slot.attempts.map((vm) => (
                <Fragment key={vm.node.id}>
                  <WorkflowGraphNodeCard
                    vm={vm}
                    needsInput={needsInputNodeRowIds.has(vm.node.id)}
                    busy={busy}
                    onFocusSession={onFocusSession}
                    onApprove={onApprove}
                    onFailRedo={onFailRedo}
                    onFlipType={onFlipType}
                    onAddAdhoc={onAddAdhoc}
                  />
                  <WorkflowGraphBranchRail
                    vms={slot.adhoc.filter((adhocVm) => adhocVm.node.anchorNodeRowId === vm.node.id)}
                    {...cardProps}
                  />
                </Fragment>
              ))}
              <WorkflowGraphBranchRail vms={orphaned} {...cardProps} />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

interface WorkflowGraphBranchRailProps {
  vms: WorkflowGraphNodeVM[];
  needsInputNodeRowIds: ReadonlySet<string>;
  busy: boolean;
  onFocusSession(nodeRowId: string): void;
  onApprove(nodeRowId: string): void;
  onFailRedo(nodeRowId: string, prompt?: string): void;
  onFlipType(nodeRowId: string, nodeType: "agent" | "human_in_loop"): void;
  onAddAdhoc(anchorNodeRowId: string, prompt: string): void;
}

/**
 * The branch rail a slot's side nodes hang from: rendered directly under the
 * attempt they anchor to, so a retry's side errand never reads as belonging
 * to a different attempt. Renders nothing for an empty group — the rail is
 * the fork's drawing, not a slot fixture.
 */
function WorkflowGraphBranchRail({
  vms,
  needsInputNodeRowIds,
  busy,
  onFocusSession,
  onApprove,
  onFailRedo,
  onFlipType,
  onAddAdhoc,
}: WorkflowGraphBranchRailProps) {
  if (vms.length === 0) return null;
  return (
    <div className="ml-6 flex flex-col gap-1.5 border-l border-border pl-3">
      {vms.map((vm) => (
        <WorkflowGraphNodeCard
          key={vm.node.id}
          vm={vm}
          secondary
          needsInput={needsInputNodeRowIds.has(vm.node.id)}
          busy={busy}
          onFocusSession={onFocusSession}
          onApprove={onApprove}
          onFailRedo={onFailRedo}
          onFlipType={onFlipType}
          onAddAdhoc={onAddAdhoc}
        />
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
