import { useMemo, type CSSProperties } from "react";

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
import { Robot } from "#product/primitives/icons/product";
import { UsersRound } from "#product/primitives/icons/platform";
import { WorkflowCanvas } from "#product/components/workflows/canvas/WorkflowCanvas";

/**
 * The design's per-tone dot inks for the run cards' status dot. Same
 * partial-read floor the rest of the run view keeps: an unknown tone renders
 * the muted ink rather than throwing.
 */
const TONE_DOT_INK: Record<WorkflowNodeTone, string> = {
  muted: "var(--color-border-heavy)",
  current: "var(--color-info)",
  info: "var(--color-info)",
  success: "var(--color-success)",
  warning: "var(--color-compute-target-amber)",
  danger: "var(--color-destructive)",
};

function toneDotInk(tone: WorkflowNodeTone): string {
  const byTone: Partial<Record<string, string>> = TONE_DOT_INK;
  return byTone[tone] ?? TONE_DOT_INK.muted;
}

export interface WorkflowGraphViewProps {
  slots: WorkflowGraphSlotVM[];
  needsInputNodeRowIds: ReadonlySet<string>;
  selectedNodeRowId: string | null;
  onSelectNode(nodeRowId: string): void;
  className?: string;
}

/**
 * The run's chain drawn as the design's graph: 200×92 cards (index chip,
 * status dot, type glyph and label, title, two-line prompt), one rank per
 * chain slot, retries widening their rank, ad hoc side nodes hanging off a
 * dashed branch edge beside their anchor. Every card is a button that selects
 * its node — the inspector the pane docks under the canvas owns the controls
 * and the session hand-off, so the canvas stays presentation.
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
      zoomChrome="run"
      className={className}
    >
      {layout.nodes.map((placed) => {
        const vm = vmsByRowId.get(placed.key);
        if (!vm) {
          return null;
        }
        const selected = placed.key === selectedNodeRowId;
        const human = vm.node.nodeType === "human_in_loop";
        const needsInput = needsInputNodeRowIds.has(placed.key);
        const wrapStyle: CSSProperties = {
          position: "absolute",
          left: placed.x,
          top: placed.y,
          width: WORKFLOW_GRAPH_NODE_WIDTH,
          height: WORKFLOW_GRAPH_NODE_HEIGHT,
          zIndex: selected ? 3 : 1,
          padding: 0,
          border: 0,
          background: "transparent",
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
          opacity: vm.tone === "muted" ? 0.5 : 1,
        };
        const cardStyle: CSSProperties = {
          position: "relative",
          boxSizing: "border-box",
          width: WORKFLOW_GRAPH_NODE_WIDTH,
          height: WORKFLOW_GRAPH_NODE_HEIGHT,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: "10px 12px",
          borderRadius: 11,
          border: "1px solid var(--color-border)",
          background: "var(--color-card)",
          boxShadow: selected
            ? "0 0 0 2px var(--color-info), 0 0 0 7px var(--color-highlight)"
            : "var(--shadow-subtle)",
        };
        return (
          <button
            key={placed.key}
            type="button"
            aria-pressed={selected}
            style={wrapStyle}
            onClick={() => onSelectNode(placed.key)}
          >
            <span style={cardStyle}>
              <span className="flex items-center justify-between" style={{ gap: 8 }}>
                <span className="flex min-w-0 items-center text-faint" style={{ gap: 6 }}>
                  <span
                    className="text-ui-sm grid flex-none place-items-center font-mono text-muted-foreground"
                    style={{
                      minWidth: 18,
                      height: 16,
                      padding: "0 4px",
                      borderRadius: 5,
                      border: "1px solid var(--color-border-light)",
                      background: "var(--color-surface-elevated-secondary)",
                      lineHeight: 1,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {WORKFLOW_NODE_CARD_COPY.nodeIndexLabel(vm.node.chainIndex)}
                  </span>
                  <span
                    aria-hidden
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      flex: "none",
                      background: toneDotInk(vm.tone),
                    }}
                  />
                  {human ? (
                    <span className="flex" style={{ color: "var(--color-compute-target-amber)" }}>
                      <UsersRound className="icon-tight" aria-hidden />
                    </span>
                  ) : (
                    <Robot className="icon-tight" aria-hidden />
                  )}
                  <span
                    className="text-ui-sm whitespace-nowrap font-mono uppercase"
                    style={{ letterSpacing: "0.07em" }}
                  >
                    {WORKFLOW_NODE_CARD_COPY.kindLine(vm.node.nodeType, vm.node.kind)}
                  </span>
                </span>
                {needsInput ? (
                  <span
                    className="text-ui-sm whitespace-nowrap text-faint"
                  >
                    {WORKFLOW_NODE_CARD_COPY.needsInputBadge}
                  </span>
                ) : null}
              </span>
              <span
                className={`text-ui truncate text-foreground ${vm.isCurrent ? "font-semibold" : "font-medium"}`}
              >
                {vm.node.title}
              </span>
              <span
                className="text-ui-sm text-muted-foreground"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {vm.node.prompt}
              </span>
            </span>
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: 95,
                top: -5,
                width: 10,
                height: 10,
                borderRadius: 999,
                background: "var(--color-surface-under)",
                border: "2px solid var(--color-border-heavy)",
              }}
            />
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: 95,
                bottom: -5,
                width: 10,
                height: 10,
                borderRadius: 999,
                background: "var(--color-surface-under)",
                border: "2px solid var(--color-border-heavy)",
              }}
            />
          </button>
        );
      })}
    </WorkflowCanvas>
  );
}
