import type { WorkflowRunRowView } from "@proliferate/product-domain/workflows/model";
import { WorkflowStatusPill } from "@proliferate/product-ui/workflows/WorkflowStatusPill";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Button } from "@proliferate/ui/primitives/Button";

export interface WorkflowRunsTableProps {
  rows: readonly WorkflowRunRowView[];
  loading?: boolean;
  onRunSelect: (runId: string) => void;
}

function formatStarted(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return "—";
  }
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Global run table for the Runs tab (spec 3.6). */
export function WorkflowRunsTable({ rows, loading = false, onRunSelect }: WorkflowRunsTableProps) {
  if (!loading && rows.length === 0) {
    return <EmptyState title="No runs yet" description="Runs appear here once a workflow starts." />;
  }
  return (
    <div className="overflow-x-auto rounded-[10px] border border-border">
      <div className="min-w-[44rem]">
        <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr] gap-2 border-b border-border bg-foreground/[0.02] px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>Workflow</span>
          <span>Trigger</span>
          <span>Status</span>
          <span>Duration</span>
          <span>Started</span>
        </div>
        {rows.map((row) => (
          <Button
            key={row.id}
            type="button"
            variant="unstyled"
            size="unstyled"
            onClick={() => onRunSelect(row.id)}
            className="grid w-full grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr] items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left text-ui-sm last:border-b-0 hover:bg-foreground/[0.03]"
          >
            <span className="truncate font-medium text-foreground">{row.workflowName}</span>
            <span className="text-muted-foreground">{row.triggerLabel}</span>
            <span>
              <WorkflowStatusPill
                label={row.statusLabel}
                tone={row.statusTone}
                title={row.statusDetail}
              />
            </span>
            <span className="tabular-nums text-muted-foreground">{row.durationLabel ?? "—"}</span>
            <span className="truncate text-muted-foreground">{formatStarted(row.startedLabel)}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
