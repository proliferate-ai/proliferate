import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { WorkflowEdgeV2, WorkflowNodeV2 } from "@proliferate/cloud-sdk";
import {
  layoutWorkflowBuilderGraph,
  type WorkflowGraphNodePlacement,
} from "#product/domain/workflows/graph-layout";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import type { WorkflowBuilderHarnessOption } from "#product/lib/domain/workflows/workflow-builder-authoring";
import { WorkflowBuilderCanvasNode } from "#product/components/workflows/builder-v2/WorkflowBuilderCanvasNode";
import { IconButton } from "#product/primitives/IconButton";
import { X } from "#product/primitives/icons/core";
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
  /** Cards the author has placed by hand, keyed by node id (or the Input sentinel). */
  nodePlacements: Readonly<Record<string, WorkflowGraphNodePlacement>>;
  statusSlot?: ReactNode;
  onSelectNode(nodeId: string): void;
  onSelectInput(): void;
  onConnectNodes(from: string, to: string): void;
  onConnectInput(to: string): void;
  onRemoveEdge(from: string, to: string): void;
  onDisconnectInput(): void;
  onMoveNode(key: string, placement: WorkflowGraphNodePlacement): void;
  disabled?: boolean;
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
  nodePlacements,
  statusSlot,
  onSelectNode,
  onSelectInput,
  onConnectNodes,
  onConnectInput,
  onRemoveEdge,
  onDisconnectInput,
  onMoveNode,
  disabled = false,
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
      nodePlacements,
    ),
    [nodePlacements, nodes, visualEdges],
  );
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const pointerEndCleanupRef = useRef<(() => void) | null>(null);

  const clearPointerEndListener = useCallback(() => {
    pointerEndCleanupRef.current?.();
    pointerEndCleanupRef.current = null;
  }, []);

  const cancelConnection = useCallback(() => {
    clearPointerEndListener();
    setDragFrom(null);
  }, [clearPointerEndListener]);

  useEffect(() => clearPointerEndListener, [clearPointerEndListener]);

  const finishConnection = (to: string) => {
    if (disabled) {
      cancelConnection();
      return;
    }
    if (dragFrom === WORKFLOW_INPUT_SENTINEL) onConnectInput(to);
    else if (dragFrom) onConnectNodes(dragFrom, to);
    cancelConnection();
  };

  const startConnection = (from: string) => {
    if (!disabled) {
      clearPointerEndListener();
      setDragFrom(from);
    }
  };

  const startPointerConnection = (
    from: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (disabled) return;
    clearPointerEndListener();
    const ownerWindow = event.currentTarget.ownerDocument.defaultView;
    if (ownerWindow) {
      const pointerId = event.pointerId;
      const onPointerEnd = (ownerEvent: globalThis.PointerEvent) => {
        if (ownerEvent.pointerId === pointerId) cancelConnection();
      };
      ownerWindow.addEventListener("pointerup", onPointerEnd);
      ownerWindow.addEventListener("pointercancel", onPointerEnd);
      pointerEndCleanupRef.current = () => {
        ownerWindow.removeEventListener("pointerup", onPointerEnd);
        ownerWindow.removeEventListener("pointercancel", onPointerEnd);
      };
    }
    setDragFrom(from);
  };

  return (
    <WorkflowCanvas
      contentWidth={layout.width}
      contentHeight={layout.height}
      edges={layout.edges}
      ariaLabel={WORKFLOW_BUILDER_COPY.chainCanvasLabel}
      statusSlot={statusSlot}
      onCancelInteraction={cancelConnection}
      className={className}
    >
      {layout.edges.map((edge) => (
        <IconButton
          key={`remove:${edge.fromKey}->${edge.toKey}`}
          size="sm"
          disabled={disabled}
          className="absolute z-raised opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100"
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
        const input = placed.key === WORKFLOW_INPUT_SENTINEL;
        const node = input ? null : nodesById.get(placed.key) ?? null;
        if (!input && !node) return null;
        return (
          <WorkflowBuilderCanvasNode
            key={placed.key}
            placed={placed}
            node={node}
            chainIndex={input ? null : index - 1}
            harnesses={harnesses}
            selected={input ? inputSelected : placed.key === selectedNodeId}
            hasIssue={issueNodeIds.has(placed.key)}
            connecting={dragFrom !== null}
            connectingFrom={dragFrom === placed.key}
            disabled={disabled}
            onSelect={input ? onSelectInput : () => onSelectNode(placed.key)}
            onFinishConnection={() => finishConnection(placed.key)}
            onStartConnection={() => startConnection(placed.key)}
            onStartPointerConnection={(event) => startPointerConnection(placed.key, event)}
            onCancelConnection={cancelConnection}
            onMove={(placement) => onMoveNode(placed.key, placement)}
          />
        );
      })}
    </WorkflowCanvas>
  );
}
