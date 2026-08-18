import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { WorkflowNodeV2 } from "@proliferate/cloud-sdk";
import {
  WORKFLOW_GRAPH_NODE_HEIGHT,
  WORKFLOW_GRAPH_NODE_WIDTH,
  type WorkflowGraphNodePlacement,
  type WorkflowGraphPlacedNode,
} from "#product/domain/workflows/graph-layout";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import { WORKFLOW_NODE_CARD_COPY } from "#product/copy/workflows/workflow-node-card-copy";
import type { WorkflowBuilderHarnessOption } from "#product/lib/domain/workflows/workflow-builder-authoring";
import { useWorkflowCanvasViewport } from "#product/components/workflows/canvas/WorkflowCanvas";
import { Button } from "#product/primitives/Button";
import { CircleAlert } from "#product/primitives/icons/status";
import { StatusDot } from "#product/primitives/StatusDot";

/**
 * Content pixels the pointer travels before a press becomes a move, so a card
 * that is clicked to select it does not also shift by a pixel or two.
 */
const MOVE_THRESHOLD = 3;
/** Keyboard nudge, matching the canvas dot-grid pitch. */
const NUDGE_STEP = 22;

export interface WorkflowBuilderCanvasNodeProps {
  placed: WorkflowGraphPlacedNode;
  /** `null` on the structural Input card, which has no step behind it. */
  node: WorkflowNodeV2 | null;
  /** Chain position for the card's index badge; `null` on the Input card. */
  chainIndex: number | null;
  harnesses: readonly WorkflowBuilderHarnessOption[];
  selected: boolean;
  hasIssue: boolean;
  /** A connection is in flight, so every input port is a live target. */
  connecting: boolean;
  /** This card is the connection's source. */
  connectingFrom: boolean;
  disabled: boolean;
  onSelect(): void;
  onFinishConnection(): void;
  onStartConnection(): void;
  onStartPointerConnection(event: ReactPointerEvent<HTMLButtonElement>): void;
  onCancelConnection(): void;
  onMove(placement: WorkflowGraphNodePlacement): void;
}

/**
 * One card on the builder canvas: the step (or the structural Input), its two
 * connection ports, and the gesture that moves it.
 *
 * Moving is a pointer drag on the card body, or arrow keys once it has focus.
 * Screen motion is divided by the canvas zoom so a card tracks the pointer at
 * any scale, and a placement never goes negative — the content box starts at
 * the origin, and a card dragged past it would sit outside what the canvas can
 * pan to or fit.
 *
 * The gesture lives on the card button rather than on the positioned wrapper
 * so that the pointer capture it takes cannot retarget the closing click away
 * from the button: pressing a card still selects it.
 */
export function WorkflowBuilderCanvasNode({
  placed,
  node,
  chainIndex,
  harnesses,
  selected,
  hasIssue,
  connecting,
  connectingFrom,
  disabled,
  onSelect,
  onFinishConnection,
  onStartConnection,
  onStartPointerConnection,
  onCancelConnection,
  onMove,
}: WorkflowBuilderCanvasNodeProps) {
  const { zoom, holdViewport } = useWorkflowCanvasViewport();
  const moveRef = useRef<
    { pointerId: number; startX: number; startY: number; originX: number; originY: number } | null
  >(null);
  const [moving, setMoving] = useState(false);
  const input = node === null;
  const modelLine = node ? nodeModelLine(node, harnesses) : null;
  const title = input
    ? WORKFLOW_BUILDER_COPY.inputNodeTitle
    : node.title.trim() || WORKFLOW_BUILDER_COPY.canvasUntitledStep;

  const startMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return;
    holdViewport();
    moveRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: placed.x,
      originY: placed.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const continueMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const move = moveRef.current;
    if (!move || move.pointerId !== event.pointerId) return;
    const dx = (event.clientX - move.startX) / zoom;
    const dy = (event.clientY - move.startY) / zoom;
    if (!moving && Math.abs(dx) + Math.abs(dy) < MOVE_THRESHOLD) return;
    setMoving(true);
    onMove({ x: Math.max(0, move.originX + dx), y: Math.max(0, move.originY + dy) });
  };

  const endMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (moveRef.current?.pointerId !== event.pointerId) return;
    moveRef.current = null;
    setMoving(false);
  };

  return (
    <div
      className={`group absolute ${moving ? "z-raised" : ""}`}
      style={{
        left: placed.x,
        top: placed.y,
        width: WORKFLOW_GRAPH_NODE_WIDTH,
        height: WORKFLOW_GRAPH_NODE_HEIGHT,
      }}
    >
      {!input ? (
        <Port
          label={`Connect into ${node.title || placed.key}`}
          position="input"
          active={false}
          available={connecting}
          disabled={disabled}
          onPointerUp={(event) => {
            event.stopPropagation();
            onFinishConnection();
          }}
          onClick={onFinishConnection}
          onLostPointerCapture={onCancelConnection}
        />
      ) : null}
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        disabled={disabled}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={(event) => nudge(event, placed, disabled, holdViewport, onMove)}
        onPointerDown={startMove}
        onPointerMove={continueMove}
        onPointerUp={endMove}
        onPointerCancel={endMove}
        onLostPointerCapture={endMove}
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
                {WORKFLOW_NODE_CARD_COPY.nodeIndexLabel(chainIndex)}
              </span>
              <StatusDot tone={node.type === "human_in_loop" ? "warning" : "info"} />
              <span className="truncate font-mono text-ui-sm uppercase tracking-wide text-muted-foreground">
                {WORKFLOW_NODE_CARD_COPY.kindLine(node.type, "defined")}
              </span>
              {hasIssue ? (
                <CircleAlert
                  className="icon-compact ml-auto shrink-0 text-destructive"
                  aria-label={WORKFLOW_BUILDER_COPY.canvasIssueMarkLabel}
                />
              ) : null}
            </>
          )}
        </span>
        <span className="w-full truncate text-ui font-medium text-foreground">{title}</span>
        <span className={`${modelLine ? "font-mono" : ""} line-clamp-2 w-full text-ui-sm text-muted-foreground`}>
          {input ? WORKFLOW_BUILDER_COPY.inputNodeSubtitle : modelLine ?? node.prompt}
        </span>
      </Button>
      <Port
        label={`Connect from ${input ? "Input" : node.title || placed.key}`}
        position="output"
        active={connectingFrom}
        available={false}
        disabled={disabled}
        onPointerDown={(event) => {
          event.stopPropagation();
          onStartPointerConnection(event);
        }}
        onClick={onStartConnection}
        onLostPointerCapture={onCancelConnection}
      />
    </div>
  );
}

/** Arrow keys move a focused card, so placement is not a pointer-only capability. */
function nudge(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  placed: WorkflowGraphPlacedNode,
  disabled: boolean,
  holdViewport: () => void,
  onMove: (placement: WorkflowGraphNodePlacement) => void,
) {
  if (disabled) return;
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
    event.key
  ];
  if (!step) return;
  // The canvas would otherwise scroll the surrounding page under the card.
  event.preventDefault();
  holdViewport();
  onMove({
    x: Math.max(0, placed.x + step[0] * NUDGE_STEP),
    y: Math.max(0, placed.y + step[1] * NUDGE_STEP),
  });
}

function Port({
  label,
  position,
  active,
  available,
  disabled,
  onPointerDown,
  onPointerUp,
  onClick,
  onLostPointerCapture,
}: {
  label: string;
  position: "input" | "output";
  active: boolean;
  available: boolean;
  disabled: boolean;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onClick?: () => void;
  onLostPointerCapture?: () => void;
}) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      aria-label={label}
      aria-pressed={position === "output" ? active : undefined}
      aria-description={position === "output"
        ? "Activate to start a connection, then activate a step input."
        : "Activate after choosing an output to finish the connection."}
      disabled={disabled}
      className={`${position === "input" ? "-top-2" : "-bottom-2"} absolute left-1/2 z-raised h-4 w-4 -translate-x-1/2 rounded-full border border-border-heavy bg-surface-elevated opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 ${active ? "opacity-100 ring-2 ring-info/30" : ""} ${available ? "opacity-100" : ""}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onLostPointerCapture={onLostPointerCapture}
    />
  );
}

function cardClassName(selected: boolean): string {
  return `flex cursor-grab flex-col items-start justify-start gap-1 overflow-hidden rounded-lg border bg-surface-elevated p-2.5 text-left shadow-subtle transition-colors active:cursor-grabbing ${selected ? "border-info ring-2 ring-info/30" : "border-border hover:border-border-heavy"}`;
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
