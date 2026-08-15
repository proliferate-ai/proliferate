import { useMemo } from "react";
import type { WorkflowNodeV2 } from "@proliferate/cloud-sdk";

import {
  layoutWorkflowChainGraph,
  WORKFLOW_GRAPH_NODE_HEIGHT,
  WORKFLOW_GRAPH_NODE_WIDTH,
} from "#product/domain/workflows/graph-layout";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import { WORKFLOW_NODE_CARD_COPY } from "#product/copy/workflows/workflow-node-card-copy";
import { CircleAlert } from "#product/primitives/icons/status";
import { StatusDot } from "#product/primitives/StatusDot";
import { WorkflowCanvas } from "#product/components/workflows/canvas/WorkflowCanvas";

export interface WorkflowBuilderChainCanvasProps {
  nodes: readonly WorkflowNodeV2[];
  selectedNodeId: string | null;
  /** Nodes the validator currently has an issue on; marked, not explained — the inspector owns the message. */
  issueNodeIds: ReadonlySet<string>;
  onSelectNode(nodeId: string): void;
  className?: string;
}

/**
 * The draft chain drawn on the workflows canvas. Presentation of the card
 * order only: the chain IS the order `useWorkflowBuilder` keeps, so the
 * canvas draws the implied edges and offers no edge editing — selecting a
 * card opens it in the inspector below, where reordering lives.
 */
export function WorkflowBuilderChainCanvas({
  nodes,
  selectedNodeId,
  issueNodeIds,
  onSelectNode,
  className,
}: WorkflowBuilderChainCanvasProps) {
  const layout = useMemo(
    () => layoutWorkflowChainGraph(nodes.map((node) => node.id)),
    [nodes],
  );
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  return (
    <WorkflowCanvas
      contentWidth={layout.width}
      contentHeight={layout.height}
      edges={layout.edges}
      ariaLabel={WORKFLOW_BUILDER_COPY.chainCanvasLabel}
      className={className}
    >
      {layout.nodes.map((placed, index) => {
        const node = nodesById.get(placed.key);
        if (!node) {
          return null;
        }
        const selected = placed.key === selectedNodeId;
        return (
          <button
            key={placed.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelectNode(placed.key)}
            className={[
              "absolute flex flex-col items-start gap-1 overflow-hidden rounded-lg border bg-surface-elevated p-2.5 text-left shadow-subtle transition-colors",
              selected
                ? "border-info ring-2 ring-info/30"
                : "border-border hover:border-border-heavy",
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
                {WORKFLOW_NODE_CARD_COPY.nodeIndexLabel(index)}
              </span>
              <StatusDot tone={node.type === "human_in_loop" ? "warning" : "info"} />
              <span className="truncate font-mono text-ui-sm uppercase tracking-wide text-muted-foreground">
                {WORKFLOW_NODE_CARD_COPY.kindLine(node.type, "defined")}
              </span>
              {issueNodeIds.has(node.id) ? (
                <CircleAlert
                  className="icon-compact ml-auto shrink-0 text-destructive"
                  aria-label={WORKFLOW_BUILDER_COPY.canvasIssueMarkLabel}
                />
              ) : null}
            </span>
            <span className="w-full truncate text-ui font-medium text-foreground">
              {node.title.trim() || WORKFLOW_BUILDER_COPY.canvasUntitledStep}
            </span>
            {node.prompt.trim().length > 0 ? (
              <span className="line-clamp-2 w-full text-ui-sm text-muted-foreground">
                {node.prompt}
              </span>
            ) : null}
          </button>
        );
      })}
    </WorkflowCanvas>
  );
}
