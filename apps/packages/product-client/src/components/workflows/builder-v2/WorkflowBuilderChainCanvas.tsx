import { useMemo, type ReactNode } from "react";
import type { WorkflowNodeV2 } from "@proliferate/cloud-sdk";

import {
  layoutWorkflowChainGraph,
  WORKFLOW_GRAPH_NODE_HEIGHT,
  WORKFLOW_GRAPH_NODE_WIDTH,
} from "#product/domain/workflows/graph-layout";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import { WORKFLOW_NODE_CARD_COPY } from "#product/copy/workflows/workflow-node-card-copy";
import type { WorkflowBuilderHarnessOption } from "#product/lib/domain/workflows/workflow-builder-authoring";
import { CircleAlert } from "#product/primitives/icons/status";
import { StatusDot } from "#product/primitives/StatusDot";
import { WorkflowCanvas } from "#product/components/workflows/canvas/WorkflowCanvas";

/**
 * The structural input card's layout key. Not a node id: the draft grammar
 * (`NODE_ID_PATTERN`) can never mint a leading dash, so this cannot collide
 * with a real step.
 */
const INPUT_KEY = "-input-";

export interface WorkflowBuilderChainCanvasProps {
  nodes: readonly WorkflowNodeV2[];
  /** Catalog vocabulary, for spelling a card's model line in display names. */
  harnesses: readonly WorkflowBuilderHarnessOption[];
  selectedNodeId: string | null;
  /** The structural input card is selected (workflow details in the inspector). */
  inputSelected: boolean;
  /** Nodes the validator currently has an issue on; marked, not explained — the inspector owns the message. */
  issueNodeIds: ReadonlySet<string>;
  /** Bottom-left readout (step counts, validity). */
  statusSlot?: ReactNode;
  onSelectNode(nodeId: string): void;
  onSelectInput(): void;
  className?: string;
}

/**
 * The draft chain drawn on the workflows canvas, headed by the structural
 * input card (the trigger payload every run starts from). Presentation of the
 * card order only: the chain IS the order `useWorkflowBuilder` keeps, so the
 * canvas draws the implied edges and offers no edge editing — selecting a
 * card opens it in the inspector, where every edit (including reordering)
 * lives.
 */
export function WorkflowBuilderChainCanvas({
  nodes,
  harnesses,
  selectedNodeId,
  inputSelected,
  issueNodeIds,
  statusSlot,
  onSelectNode,
  onSelectInput,
  className,
}: WorkflowBuilderChainCanvasProps) {
  const layout = useMemo(
    () => layoutWorkflowChainGraph([INPUT_KEY, ...nodes.map((node) => node.id)]),
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
      statusSlot={statusSlot}
      className={className}
    >
      {layout.nodes.map((placed, index) => {
        const cardStyle = {
          left: placed.x,
          top: placed.y,
          width: WORKFLOW_GRAPH_NODE_WIDTH,
          height: WORKFLOW_GRAPH_NODE_HEIGHT,
        };
        if (placed.key === INPUT_KEY) {
          return (
            <button
              key={placed.key}
              type="button"
              aria-pressed={inputSelected}
              onClick={onSelectInput}
              className={cardClassName(inputSelected)}
              style={cardStyle}
            >
              <span className="flex w-full min-w-0 items-center gap-1.5">
                <StatusDot tone="muted" />
                <span className="truncate font-mono text-ui-sm uppercase tracking-wide text-muted-foreground">
                  {WORKFLOW_BUILDER_COPY.inputNodeKindLabel}
                </span>
              </span>
              <span className="w-full truncate text-ui font-medium text-foreground">
                {WORKFLOW_BUILDER_COPY.inputNodeTitle}
              </span>
              <span className="line-clamp-2 w-full text-ui-sm text-muted-foreground">
                {WORKFLOW_BUILDER_COPY.inputNodeSubtitle}
              </span>
            </button>
          );
        }

        const node = nodesById.get(placed.key);
        if (!node) {
          return null;
        }
        const selected = placed.key === selectedNodeId;
        const modelLine = nodeModelLine(node, harnesses);
        return (
          <button
            key={placed.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelectNode(placed.key)}
            className={cardClassName(selected)}
            style={cardStyle}
          >
            <span className="flex w-full min-w-0 items-center gap-1.5">
              <span className="font-mono text-ui-sm text-muted-foreground">
                {WORKFLOW_NODE_CARD_COPY.nodeIndexLabel(index - 1)}
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
            {modelLine ? (
              <span className="w-full truncate font-mono text-ui-sm text-muted-foreground">
                {modelLine}
              </span>
            ) : node.prompt.trim().length > 0 ? (
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

function cardClassName(selected: boolean): string {
  return [
    "absolute flex flex-col items-start gap-1 overflow-hidden rounded-lg border bg-surface-elevated p-2.5 text-left shadow-subtle transition-colors",
    selected ? "border-info ring-2 ring-info/30" : "border-border hover:border-border-heavy",
  ].join(" ");
}

/**
 * "Claude · Sonnet" — the card's model line in catalog display names, or the
 * raw ids while the catalog has no word for them. `null` when the node rides
 * the run's default, so the prompt preview takes the line instead.
 */
function nodeModelLine(
  node: WorkflowNodeV2,
  harnesses: readonly WorkflowBuilderHarnessOption[],
): string | null {
  if (!node.model) {
    return null;
  }
  const harness = harnesses.find((option) => option.agentKind === node.model?.agentKind);
  const harnessLabel = harness?.label ?? node.model.agentKind;
  if (!node.model.modelId) {
    return harnessLabel;
  }
  const modelLabel = harness?.models.find((model) => model.id === node.model?.modelId)?.label
    ?? node.model.modelId;
  return `${harnessLabel} · ${modelLabel}`;
}
