import { coerceRunStatus } from "@proliferate/product-domain/workflows/run-status";
import { SegmentedControl } from "@proliferate/ui/primitives/SegmentedControl";
import type { WorkflowResponse, WorkflowRunResponse } from "@/hooks/access/cloud/workflows/types";
import {
  buildRunRowView,
  runFilterMatches,
  type RunStatusFilter,
} from "@/hooks/workflows/derived/workflow-run-row-view";
import { Chip, TargetGlyph, WorkflowRunRow } from "./WorkflowListRow";

export interface WorkflowRunsDrillInProps {
  workflow: WorkflowResponse;
  /** Every run for every workflow (already newest-first) — filtered here to
   * this workflow's own runs. */
  runs: readonly WorkflowRunResponse[];
  runFilter: RunStatusFilter;
  onRunFilterChange: (filter: RunStatusFilter) => void;
  onOpenRun: (runId: string) => void;
}

/** Drill-in view (workflow list -> its runs, newest first): target chip, run
 * status filter, run rows. */
export function WorkflowRunsDrillIn({ workflow, runs, runFilter, onRunFilterChange, onOpenRun }: WorkflowRunsDrillInProps) {
  const workflowRuns = runs.filter((run) => run.workflowId === workflow.id);
  const openRuns = workflowRuns.filter((run) => runFilterMatches(runFilter, coerceRunStatus(run.status)));
  // Newest run for this workflow (runs arrive newest-first from the server) —
  // unaffected by the status filter, since the chip reflects the true last run.
  const lastRun = workflowRuns[0] ?? null;
  // Schedule facts render per-row; the drill-in header keeps target only.
  const openScheduleChipLabel: string | null = null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 pb-1">
        <span className="min-w-0 flex-1" />
        {openScheduleChipLabel ? <Chip>{openScheduleChipLabel}</Chip> : null}
        {lastRun?.targetMode ? (
          <Chip>
            <TargetGlyph target={lastRun.targetMode === "personal_cloud" ? "cloud" : "local"} className="size-3" />
            {lastRun.targetMode === "personal_cloud" ? "cloud" : "local"}
          </Chip>
        ) : null}
      </div>
      <div className="flex items-center gap-2 pb-2">
        <SegmentedControl
          ariaLabel="Filter runs by status"
          value={runFilter}
          onChange={onRunFilterChange}
          items={[
            { id: "all", label: "All" },
            { id: "running", label: "Running" },
            { id: "success", label: "Completed" },
            { id: "failed", label: "Failed" },
          ]}
        />
      </div>
      {openRuns.map((run) => (
        <WorkflowRunRow key={run.id} view={buildRunRowView(run)} onOpen={() => onOpenRun(run.id)} />
      ))}
      {openRuns.length === 0 ? (
        <span className="px-1 py-4 text-xs text-faint">
          {runFilter === "all" ? "No runs yet — Run it to see history here." : "No runs match this filter."}
        </span>
      ) : null}
    </div>
  );
}
