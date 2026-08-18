import { useMemo, useState, type PointerEvent, type ReactNode } from "react";
import type { WorkflowEdgeV2, WorkflowNodeV2 } from "@proliferate/cloud-sdk";
import {
  layoutWorkflowBuilderGraph,
  WORKFLOW_GRAPH_NODE_HEIGHT,
  WORKFLOW_GRAPH_NODE_WIDTH,
} from "#product/domain/workflows/graph-layout";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import { WORKFLOW_NODE_CARD_COPY } from "#product/copy/workflows/workflow-node-card-copy";
import type { WorkflowBuilderHarnessOption } from "#product/lib/domain/workflows/workflow-builder-authoring";
import { Button } from "#product/primitives/Button";
import { IconButton } from "#product/primitives/IconButton";
import { X } from "#product/primitives/icons/core";
import { CircleAlert } from "#product/primitives/icons/status";
import { StatusDot } from "#product/primitives/StatusDot";
import { WorkflowCanvas } from "#product/components/workflows/canvas/WorkflowCanvas";

export const WORKFLOW_INPUT_SENTINEL = "-input-";

export interface WorkflowBuilderChainCanvasProps {
  nodes: readonly WorkflowNodeV2[];
  edges: readonly WorkflowEdgeV2[];
  inputConnectedTo: string | null;
  harnesses: readonly WorkflowBuilderHarnessOption[];
  selectedNodeId: string | null;
  inputSelected: boolean;
  issueNodeIds: ReadonlySet<string>;
  statusSlot?: ReactNode;
  onSelectNode(nodeId: string): void;
  onSelectInput(): void;
  onConnectNodes(from: string, to: string): void;
  onConnectInput(to: string): void;
  onRemoveEdge(from: string, to: string): void;
  onDisconnectInput(): void;
  className?: string;
}

/** The deterministic builder graph, with explicit port-to-port edge authoring. */
export function WorkflowBuilderChainCanvas({
  nodes,
  edges,
  inputConnectedTo,
  harnesses,
  selectedNodeId,
  inputSelected,
  issueNodeIds,
  statusSlot,
  onSelectNode,
  onSelectInput,
  onConnectNodes,
  onConnectInput,
  onRemoveEdge,
  onDisconnectInput,
  className,
}: WorkflowBuilderChainCanvasProps) {
  const visualEdges = useMemo(() => [
    ...(inputConnectedTo ? [{ from: WORKFLOW_INPUT_SENTINEL, to: inputConnectedTo }] : []),
    ...edges,
  ], [edges, inputConnectedTo]);
  const layout = useMemo(
    () => layoutWorkflowBuilderGraph(
      [WORKFLOW_INPUT_SENTINEL, ...nodes.map((node) => node.id)],
      visualEdges,
    ),
    [nodes, visualEdges],
  );
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const [dragFrom, setDragFrom] = useState<string | null>(null);

  const finishConnection = (event: PointerEvent<HTMLButtonElement>, to: string) => {
    event.stopPropagation();
    if (dragFrom === WORKFLOW_INPUT_SENTINEL) onConnectInput(to);
    else if (dragFrom) onConnectNodes(dragFrom, to);
    setDragFrom(null);
  };

  return (
    <WorkflowCanvas
      contentWidth={layout.width}
      contentHeight={layout.height}
      edges={layout.edges}
      ariaLabel={WORKFLOW_BUILDER_COPY.chainCanvasLabel}
      statusSlot={statusSlot}
      className={className}
    >
      {layout.edges.map((edge) => (
        <IconButton
          key={`remove:${edge.fromKey}->${edge.toKey}`}
          size="sm"
          className="absolute opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          style={{ left: edge.midpoint.x - 10, top: edge.midpoint.y - 10 }}
          aria-label={`Remove connection from ${edge.fromKey} to ${edge.toKey}`}
          title="Remove connection"
          onClick={() => edge.fromKey === WORKFLOW_INPUT_SENTINEL
            ? onDisconnectInput()
            : onRemoveEdge(edge.fromKey, edge.toKey)}
        >
          <X className="icon-compact" aria-hidden />
        </IconButton>
      ))}
      {layout.nodes.map((placed, index) => {
        const cardStyle = {
          left: placed.x,
          top: placed.y,
          width: WORKFLOW_GRAPH_NODE_WIDTH,
          height: WORKFLOW_GRAPH_NODE_HEIGHT,
        };
        const input = placed.key === WORKFLOW_INPUT_SENTINEL;
        const node = input ? null : nodesById.get(placed.key) ?? null;
        if (!input && !node) return null;
        const selected = input ? inputSelected : placed.key === selectedNodeId;
        const modelLine = node ? nodeModelLine(node, harnesses) : null;
        return (
          <div key={placed.key} className="group absolute" style={cardStyle}>
            {!input ? (
              <Port
                label={`Connect into ${node?.title || placed.key}`}
                position="input"
                active={dragFrom !== null}
                onPointerUp={(event) => finishConnection(event, placed.key)}
              />
            ) : null}
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              aria-pressed={selected}
              onClick={input ? onSelectInput : () => onSelectNode(placed.key)}
              className={`${cardClassName(selected)} h-full w-full`}
            >
              <span className="flex w-full min-w-0 items-center gap-1.5">
                {input ? (
                  <>
                    <StatusDot tone="muted" />
                    <span className="truncate font-mono text-ui-sm uppercase tracking-wide text-muted-foreground">
                      {WORKFLOW_BUILDER_COPY.inputNodeKindLabel}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-ui-sm text-muted-foreground">
                      {WORKFLOW_NODE_CARD_COPY.nodeIndexLabel(index - 1)}
                    </span>
                    <StatusDot tone={node?.type === "human_in_loop" ? "warning" : "info"} />
                    <span className="truncate font-mono text-ui-sm uppercase tracking-wide text-muted-foreground">
                      {WORKFLOW_NODE_CARD_COPY.kindLine(node!.type, "defined")}
                    </span>
                    {issueNodeIds.has(placed.key) ? (
                      <CircleAlert className="icon-compact ml-auto shrink-0 text-destructive" aria-label={WORKFLOW_BUILDER_COPY.canvasIssueMarkLabel} />
                    ) : null}
                  </>
                )}
              </span>
              <span className="w-full truncate text-ui font-medium text-foreground">
                {input ? WORKFLOW_BUILDER_COPY.inputNodeTitle : node!.title.trim() || WORKFLOW_BUILDER_COPY.canvasUntitledStep}
              </span>
              <span className={`${modelLine ? "font-mono" : ""} line-clamp-2 w-full text-ui-sm text-muted-foreground`}>
                {input ? WORKFLOW_BUILDER_COPY.inputNodeSubtitle : modelLine ?? node!.prompt}
              </span>
            </Button>
            <Port
              label={`Connect from ${input ? "Input" : node?.title || placed.key}`}
              position="output"
              active={dragFrom === placed.key}
              onPointerDown={(event) => {
                event.stopPropagation();
                setDragFrom(placed.key);
              }}
            />
          </div>
        );
      })}
    </WorkflowCanvas>
  );
}

function Port({
  label,
  position,
  active,
  onPointerDown,
  onPointerUp,
}: {
  label: string;
  position: "input" | "output";
  active: boolean;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      aria-label={label}
      className={`${position === "input" ? "-top-2" : "-bottom-2"} absolute left-1/2 z-raised h-4 w-4 -translate-x-1/2 rounded-full border border-border-heavy bg-surface-elevated opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 ${active ? "opacity-100 ring-2 ring-info/30" : ""}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    />
  );
}

function cardClassName(selected: boolean): string {
  return `flex flex-col items-start justify-start gap-1 overflow-hidden rounded-lg border bg-surface-elevated p-2.5 text-left shadow-subtle transition-colors ${selected ? "border-info ring-2 ring-info/30" : "border-border hover:border-border-heavy"}`;
}

function nodeModelLine(
  node: WorkflowNodeV2,
  harnesses: readonly WorkflowBuilderHarnessOption[],
): string | null {
  if (!node.model) return null;
  const harness = harnesses.find((option) => option.agentKind === node.model?.agentKind);
  const harnessLabel = harness?.label ?? node.model.agentKind;
  if (!node.model.modelId) return harnessLabel;
  const modelLabel = harness?.models.find((model) => model.id === node.model?.modelId)?.label
    ?? node.model.modelId;
  return `${harnessLabel} · ${modelLabel}`;
}
