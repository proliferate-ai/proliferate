import { useMemo } from "react";

import type {
  WorkflowGraphNodeVM,
  WorkflowGraphSlotVM,
  WorkflowNodeTone,
} from "#product/domain/workflows/run-view-model";
import {
  layoutWorkflowRunGraph,
  WORKFLOW_GRAPH_NODE_HEIGHT,
  WORKFLOW_GRAPH_NODE_WIDTH,
} from "#product/domain/workflows/graph-layout";
import { WORKFLOW_NODE_CARD_COPY } from "#product/copy/workflows/workflow-node-card-copy";
import { WORKFLOW_RUN_VIEW_COPY } from "#product/copy/workflows/workflow-run-view-copy";
import { Badge } from "#product/primitives/Badge";
import { StatusDot, type StatusDotTone } from "#product/primitives/StatusDot";
import { WorkflowCanvas } from "#product/components/workflows/canvas/WorkflowCanvas";

/**
 * Same tone floor the node card keeps: `StatusDot` throws on a tone outside
 * its map, so an unknown domain tone lands on `muted` instead of taking the
 * app to crash recovery.
 */
const WORKFLOW_NODE_STATUS_DOT_TONE: Record<WorkflowNodeTone, StatusDotTone> = {
  muted: "muted",
  current: "current",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
};

function statusDotToneFor(tone: WorkflowNodeTone): StatusDotTone {
  const byTone: Partial<Record<string, StatusDotTone>> = WORKFLOW_NODE_STATUS_DOT_TONE;
  return byTone[tone] ?? "muted";
}

export interface WorkflowGraphViewProps {
  slots: WorkflowGraphSlotVM[];
  needsInputNodeRowIds: ReadonlySet<string>;
  selectedNodeRowId: string | null;
  onSelectNode(nodeRowId: string): void;
  className?: string;
}

/**
 * The run's chain drawn as a real graph on the workflows canvas: one rank per
 * chain slot, retries widening their rank, ad hoc side nodes hanging off a
 * dashed branch edge in the lane beside their anchor. Every card is a button
 * that selects its node — the inspector the pane docks under the canvas owns
 * the controls and the session hand-off, so the canvas stays presentation.
 */
export function WorkflowGraphView({
  slots,
  needsInputNodeRowIds,
  selectedNodeRowId,
  onSelectNode,
  className,
}: WorkflowGraphViewProps) {
  const layout = useMemo(() => layoutWorkflowRunGraph(slots), [slots]);
  const vmsByRowId = useMemo(() => {
    const map = new Map<string, WorkflowGraphNodeVM>();
    for (const slot of slots) {
      for (const vm of [...slot.attempts, ...slot.adhoc]) {
        map.set(vm.node.id, vm);
      }
    }
    return map;
  }, [slots]);

  return (
    <WorkflowCanvas
      contentWidth={layout.width}
      contentHeight={layout.height}
      edges={layout.edges}
      ariaLabel={WORKFLOW_RUN_VIEW_COPY.graphCanvasLabel}
      className={className}
    >
      {layout.nodes.map((placed) => {
        const vm = vmsByRowId.get(placed.key);
        if (!vm) {
          return null;
        }
        const selected = placed.key === selectedNodeRowId;
        return (
          <button
            key={placed.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelectNode(placed.key)}
            className={[
              "absolute flex flex-col items-start gap-1 overflow-hidden rounded-lg border p-2.5 text-left shadow-subtle transition-colors",
              placed.branch ? "bg-surface-tint" : "bg-surface-elevated",
              selected
                ? "border-info ring-2 ring-info/30"
                : "border-border hover:border-border-heavy",
              vm.tone === "muted" ? "opacity-60" : "",
            ].join(" ")}
            style={{
              left: placed.x,
              top: placed.y,
              width: WORKFLOW_GRAPH_NODE_WIDTH,
              height: WORKFLOW_GRAPH_NODE_HEIGHT,
            }}
          >
            <span className="flex w-full min-w-0 items-center gap-1.5">
              <span className="font-mono text-ui-sm text-muted-foreground">
                {WORKFLOW_NODE_CARD_COPY.nodeIndexLabel(vm.node.chainIndex)}
              </span>
              <StatusDot tone={statusDotToneFor(vm.tone)} />
              <span className="truncate font-mono text-ui-sm uppercase tracking-wide text-muted-foreground">
                {WORKFLOW_NODE_CARD_COPY.kindLine(vm.node.nodeType, vm.node.kind)}
              </span>
            </span>
            <span
              className={`w-full truncate text-ui text-foreground ${vm.isCurrent ? "font-semibold" : "font-medium"}`}
            >
              {vm.node.title}
            </span>
            {needsInputNodeRowIds.has(placed.key) ? (
              <Badge tone="info" size="micro">
                {WORKFLOW_NODE_CARD_COPY.needsInputBadge}
              </Badge>
            ) : vm.node.prompt.trim().length > 0 ? (
              <span className="line-clamp-2 w-full text-ui-sm text-muted-foreground">
                {vm.node.prompt}
              </span>
            ) : null}
          </button>
        );
      })}
    </WorkflowCanvas>
  );
}
