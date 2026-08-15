import type { WorkflowRunV2 } from "@anyharness/sdk";
import { WORKFLOW_MAIN_COPY } from "#product/copy/workflows/workflow-main-copy";
import { WORKFLOW_RUN_VIEW_COPY } from "#product/copy/workflows/workflow-run-view-copy";
import {
  formatWorkflowRunElapsed,
  workflowRunDefinitionTitle,
} from "#product/domain/workflows/main-view-model";
import { Spinner } from "#product/primitives/Spinner";
import { CheckCircleFilled, CircleAlert } from "#product/primitives/icons/status";
import { Clock } from "#product/primitives/icons/core";
import { Card } from "#product/primitives/patterns/Card";
import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { formatRelativeTime } from "#product/lib/domain/workspaces/display/workspace-display";

/**
 * The runs recorded from this runtime's workflows, as the main page's second
 * group — the design's Executions list. Each row is the run's identity
 * (definition title, with the same no-title fallback the resume popover
 * wears), its state in words (the leading glyph is decorative — `RosterRow`
 * silences it), and when it happened; selecting a row opens the run's
 * workspace, where the execution pane owns everything deeper.
 */
export function WorkflowMainExecutionsGroup({
  runs,
  onOpen,
}: {
  runs: readonly WorkflowRunV2[];
  onOpen: (run: WorkflowRunV2) => void;
}) {
  return (
    <Card
      surface="opaque"
      as="section"
      className="flex flex-col gap-0.5 p-2"
      header={(
        <div className="flex flex-col gap-0.5 px-3 py-2">
          <h2 className="text-ui font-medium text-foreground">
            {WORKFLOW_MAIN_COPY.executionsGroupTitle}
          </h2>
          <p className="text-ui-sm text-muted-foreground">
            {WORKFLOW_MAIN_COPY.executionsGroupDescription}
          </p>
        </div>
      )}
    >
      {runs.map((run) => (
        <RosterRow
          key={run.id}
          density="comfortable"
          leading={<WorkflowExecutionGlyph status={run.status} />}
          title={workflowRunDefinitionTitle(run.definitionJson)
            ?? WORKFLOW_MAIN_COPY.executionFallbackTitle}
          secondary={executionMetaLine(run)}
          trailing={formatRelativeTime(run.createdAt)}
          onSelect={() => onOpen(run)}
        />
      ))}
    </Card>
  );
}

/**
 * "Succeeded · 1m 40s" — the run's state in words plus its wall clock once it
 * has one. The words carry the status (the glyph beside them is aria-hidden);
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
 * Decorative only — `RosterRow`'s leading slot is aria-hidden, and the words
 * in `secondary` carry the same state.
 */
function WorkflowExecutionGlyph({ status }: { status: WorkflowRunV2["status"] }) {
  if (status === "running" || status === "awaiting_human") {
    return <Spinner className="icon-compact text-muted-foreground" />;
  }
  if (status === "completed") {
    return <CheckCircleFilled className="icon-compact text-success" />;
  }
  if (status === "failed") {
    return <CircleAlert className="icon-compact text-destructive" />;
  }
  return <Clock className="icon-compact text-muted-foreground" />;
}
