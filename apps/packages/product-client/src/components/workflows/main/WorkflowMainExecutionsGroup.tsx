import { useRef, type CSSProperties } from "react";
import type { WorkflowRunV2 } from "@anyharness/sdk";
import { useVirtualizer } from "@tanstack/react-virtual";
import { WORKFLOW_MAIN_COPY } from "#product/copy/workflows/workflow-main-copy";
import { WORKFLOW_RUN_VIEW_COPY } from "#product/copy/workflows/workflow-run-view-copy";
import {
  formatWorkflowRunElapsed,
  workflowRunDefinitionTitle,
} from "#product/domain/workflows/main-view-model";
import { Spinner } from "#product/primitives/Spinner";
import { CheckCircleFilled, CircleAlert } from "#product/primitives/icons/status";
import { ChevronRight, Clock } from "#product/primitives/icons/core";
import { formatRelativeTime } from "#product/lib/domain/workspaces/display/workspace-display";

/** The design's 36px index row, used as the virtualizer's estimate. */
const EXECUTION_ROW_ESTIMATE_PX = 36;
/** Caps the group's own scroll so a long execution history never grows the page past a few rows tall. */
const EXECUTIONS_LIST_MAX_HEIGHT_PX = 420;

/**
 * The runs recorded from this runtime's workflows, in the design's index-row
 * anatomy: a per-state glyph, the run's title, its mono short id, its state in
 * words with the wall clock, and when it started. Selecting a row opens the
 * run's workspace, where the execution pane owns everything deeper.
 */
export function WorkflowMainExecutionsGroup({
  runs,
  onOpen,
}: {
  runs: readonly WorkflowRunV2[];
  onOpen: (run: WorkflowRunV2) => void;
}) {
  return <VirtualizedExecutionRows runs={runs} onOpen={onOpen} />;
}

/**
 * The executions list virtualized over its own bounded scrollport (the
 * repository's virtualization path — see `FileTreeDirectory`'s
 * `VirtualizedTree` for the same `@tanstack/react-virtual` shape), so an
 * unbounded run history never renders every row at once.
 */
function VirtualizedExecutionRows({
  runs,
  onOpen,
}: {
  runs: readonly WorkflowRunV2[];
  onOpen: (run: WorkflowRunV2) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: runs.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => runs[index]?.id ?? index,
    estimateSize: () => EXECUTION_ROW_ESTIMATE_PX,
    overscan: 10,
    // jsdom (tests) and pre-layout frames report a zero-height scroll
    // element; seed a viewport so initial rows render.
    initialRect: { width: 400, height: EXECUTIONS_LIST_MAX_HEIGHT_PX },
    measureElement: (element) => element.getBoundingClientRect().height || EXECUTION_ROW_ESTIMATE_PX,
  });

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto"
      style={{ maxHeight: EXECUTIONS_LIST_MAX_HEIGHT_PX }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const run = runs[virtualItem.index]!;
          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <WorkflowExecutionRow run={run} onOpen={onOpen} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const executionRowStyle: CSSProperties = {
  display: "flex",
  width: "100%",
  alignItems: "center",
  gap: 12,
  minHeight: 36,
  padding: "5px 10px",
  borderRadius: 8,
  border: 0,
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
  font: "inherit",
};

function WorkflowExecutionRow({
  run,
  onOpen,
}: {
  run: WorkflowRunV2;
  onOpen: (run: WorkflowRunV2) => void;
}) {
  const title = workflowRunDefinitionTitle(run.definitionJson)
    ?? WORKFLOW_MAIN_COPY.executionFallbackTitle;
  return (
    <button type="button" className="hover:bg-hover" style={executionRowStyle} onClick={() => onOpen(run)}>
      <span
        className="flex flex-none items-center justify-center text-faint"
        style={{ width: 16, height: 16 }}
      >
        <WorkflowExecutionGlyph status={run.status} />
      </span>
      <span className="flex min-w-0 flex-1 items-center" style={{ gap: 8 }}>
        <span
          className="text-ui truncate font-medium text-foreground"
          style={{ flex: "0 1 200px", minWidth: 96 }}
        >
          {title}
        </span>
        <span className="flex flex-none text-faint">
          <ChevronRight className="icon-paired" aria-hidden />
        </span>
        <span
          className="text-ui-sm truncate font-mono text-muted-foreground"
          style={{ flex: "0 1 auto", minWidth: 64, maxWidth: 260 }}
        >
          {run.id.slice(0, 8)}
        </span>
        <span
          className="text-ui-sm truncate text-faint"
          style={{ flex: "0 1 auto", minWidth: 88 }}
        >
          {executionMetaLine(run)}
        </span>
      </span>
      <span className="text-ui-sm flex-none text-faint">{formatRelativeTime(run.createdAt)}</span>
    </button>
  );
}

/**
 * "Succeeded · 1m 40s" — the run's state in words plus its wall clock once it
 * has one. The words carry the status (the glyph beside them is decorative);
 * a status this build has no label for renders nothing rather than a guess.
 */
function executionMetaLine(run: WorkflowRunV2): string | undefined {
  const label = WORKFLOW_RUN_VIEW_COPY.runStatusLabel(run.status);
  if (!label) {
    return undefined;
  }
  const elapsed = formatWorkflowRunElapsed(run);
  return elapsed ? `${label} · ${elapsed}` : label;
}

/**
 * The design's per-state marks: a live spinner while the run still moves, the
 * filled check on success, the alert circle on failure, a clock while parked.
 */
function WorkflowExecutionGlyph({ status }: { status: WorkflowRunV2["status"] }) {
  if (status === "running" || status === "awaiting_human") {
    return <Spinner className="icon-paired text-faint" />;
  }
  if (status === "completed") {
    return <CheckCircleFilled className="icon-paired text-success" />;
  }
  if (status === "failed") {
    return <CircleAlert className="icon-paired text-destructive" />;
  }
  return <Clock className="icon-paired text-faint" />;
}
