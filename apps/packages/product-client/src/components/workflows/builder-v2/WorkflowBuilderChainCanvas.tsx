import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { WorkflowNodeV2 } from "@proliferate/cloud-sdk";

import {
  layoutWorkflowChainGraph,
  WORKFLOW_BUILDER_NODE_WIDTH,
} from "#product/domain/workflows/graph-layout";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import type { WorkflowBuilderHarnessOption } from "#product/lib/domain/workflows/workflow-builder-authoring";
import { WorkflowCanvas } from "#product/components/workflows/canvas/WorkflowCanvas";

/**
 * The structural input card's layout key. Not a node id: the draft grammar
 * (`NODE_ID_PATTERN`) can never mint a leading dash, so this cannot collide
 * with a real step.
 */
const INPUT_KEY = "-input-";

/** The design's kind vocabulary: accent ink and card label per node kind. */
const KIND = {
  input: { label: "Input", accent: "var(--color-faint)" },
  agent: { label: "Agent", accent: "var(--color-info)" },
  human_in_loop: { label: "Human in the loop", accent: "var(--color-compute-target-amber)" },
} as const;

export interface WorkflowBuilderChainCanvasProps {
  nodes: readonly WorkflowNodeV2[];
  /** Catalog vocabulary, for spelling a card's model line in display names. */
  harnesses: readonly WorkflowBuilderHarnessOption[];
  selectedNodeId: string | null;
  /** The structural input card is selected (workflow details in the inspector). */
  inputSelected: boolean;
  /** Bottom-left readout (step counts, validity). */
  statusSlot?: ReactNode;
  onSelectNode(nodeId: string): void;
  onSelectInput(): void;
  onClearSelection(): void;
  className?: string;
}

/**
 * The draft chain drawn on the workflows canvas, headed by the structural
 * input card — a direct port of the design's authoring cards: 208×84, radius
 * 12, kind dot + mono index + kind label header, prompt summary, model line,
 * and the in/out ports on the card's spine. Presentation of the card order
 * only: the chain IS the order `useWorkflowBuilder` keeps, so the canvas
 * draws the implied edges and offers no edge editing — selecting a card opens
 * it in the inspector, where every edit (including reordering) lives.
 */
export function WorkflowBuilderChainCanvas({
  nodes,
  harnesses,
  selectedNodeId,
  inputSelected,
  statusSlot,
  onSelectNode,
  onSelectInput,
  onClearSelection,
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
      zoomChrome="builder"
      statusSlot={statusSlot}
      onBackgroundPress={onClearSelection}
      className={className}
    >
      {layout.nodes.map((placed, index) => {
        if (placed.key === INPUT_KEY) {
          return (
            <BuilderCanvasCard
              key={placed.key}
              x={placed.x}
              y={placed.y}
              accent={KIND.input.accent}
              selected={inputSelected}
              kindLabel={KIND.input.label}
              indexLabel={null}
              title={WORKFLOW_BUILDER_COPY.inputNodeTitle}
              summary={WORKFLOW_BUILDER_COPY.inputNodeSubtitle}
              summaryPresent={false}
              modelLine={null}
              hasInPort={false}
              nodeId={null}
              onSelect={onSelectInput}
            />
          );
        }

        const node = nodesById.get(placed.key);
        if (!node) {
          return null;
        }
        const kind = node.type === "human_in_loop" ? KIND.human_in_loop : KIND.agent;
        const promptLine = firstLine(node.prompt);
        return (
          <BuilderCanvasCard
            key={placed.key}
            x={placed.x}
            y={placed.y}
            accent={kind.accent}
            selected={placed.key === selectedNodeId}
            kindLabel={kind.label}
            indexLabel={String(index - 1).padStart(2, "0")}
            title={node.title.trim() || WORKFLOW_BUILDER_COPY.canvasUntitledStep}
            summary={promptLine ?? WORKFLOW_BUILDER_COPY.canvasNoPrompt}
            summaryPresent={promptLine !== null}
            modelLine={nodeModelLine(node, harnesses)}
            hasInPort
            nodeId={node.id}
            onSelect={() => onSelectNode(placed.key)}
          />
        );
      })}
    </WorkflowCanvas>
  );
}

function firstLine(prompt: string): string | null {
  const line = prompt.split("\n").map((part) => part.trim()).find((part) => part.length > 0);
  return line ?? null;
}

function BuilderCanvasCard({
  x,
  y,
  accent,
  selected,
  kindLabel,
  indexLabel,
  title,
  summary,
  summaryPresent,
  modelLine,
  hasInPort,
  nodeId,
  onSelect,
}: {
  x: number;
  y: number;
  accent: string;
  selected: boolean;
  kindLabel: string;
  indexLabel: string | null;
  title: string;
  summary: string;
  /** A written summary reads muted; a placeholder reads faint. */
  summaryPresent: boolean;
  modelLine: string | null;
  hasInPort: boolean;
  nodeId: string | null;
  onSelect: () => void;
}) {
  const cardStyle: CSSProperties = {
    position: "absolute",
    left: x,
    top: y,
    width: WORKFLOW_BUILDER_NODE_WIDTH,
    minHeight: 84,
    zIndex: selected ? 3 : 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 5,
    padding: "9px 11px 11px",
    borderRadius: 12,
    border: `1px solid ${selected ? accent : "var(--color-border)"}`,
    background: "var(--color-surface-elevated)",
    boxShadow: selected ? "0 0 0 3px var(--color-highlight)" : "0 1px 2px rgba(0,0,0,0.16)",
    userSelect: "none",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
  };
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-workflow-node-id={nodeId ?? undefined}
      style={cardStyle}
      onFocus={onSelect}
      onClick={onSelect}
    >
      {hasInPort ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -4,
            left: "50%",
            marginLeft: -4,
            width: 8,
            height: 8,
            borderRadius: 999,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border-heavy)",
          }}
        />
      ) : null}
      <span className="flex min-w-0 items-center" style={{ gap: 7 }}>
        <span
          aria-hidden
          style={{ width: 7, height: 7, borderRadius: 999, flex: "none", background: accent }}
        />
        {indexLabel !== null ? (
          <span className="text-ui-sm font-mono text-faint" style={{ flex: "none" }}>
            {indexLabel}
          </span>
        ) : null}
        <span
          className="text-ui-sm min-w-0 truncate font-mono uppercase text-faint"
          style={{ letterSpacing: "0.06em" }}
        >
          {kindLabel}
        </span>
      </span>
      <span className="text-ui truncate font-medium text-foreground">{title}</span>
      <span
        className={`text-ui-sm ${summaryPresent ? "text-muted-foreground" : "text-faint"}`}
        style={{
          margin: 0,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {summary}
      </span>
      {modelLine ? (
        <span className="text-ui-sm truncate font-mono text-faint">
          {modelLine}
        </span>
      ) : null}
      <span
        aria-hidden
        style={{
          position: "absolute",
          bottom: -6,
          left: "50%",
          marginLeft: -6,
          width: 12,
          height: 12,
          borderRadius: 999,
          background: "var(--color-surface)",
          border: `1.5px solid ${accent}`,
        }}
      />
    </button>
  );
}

/**
 * "Claude · Sonnet" — the card's model line in catalog display names, or the
 * raw ids while the catalog has no word for them. `null` when the node rides
 * the run's default, so the summary keeps the space.
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
