import {
  workflowHistoryItemPresentation,
  workflowRunStatusDotTone,
  type WorkflowRunHistoryItem,
} from "#product/domain/workflows/run-presentation";
import { Button } from "#product/primitives/Button";
import { StatusDot } from "#product/primitives/StatusDot";
import { Card } from "#product/primitives/patterns/Card";
import { RosterRow } from "#product/primitives/patterns/RosterRow";

export interface WorkflowRunListProps {
  runs: readonly WorkflowRunHistoryItem[];
  loading?: boolean;
  error?: string | null;
  hasMore?: boolean;
  loadingMore?: boolean;
  onSelect: (runId: string) => void;
  onLoadMore?: () => void;
  onRetry?: () => void;
}

export function WorkflowRunList({
  runs,
  loading = false,
  error = null,
  hasMore = false,
  loadingMore = false,
  onSelect,
  onLoadMore,
  onRetry,
}: WorkflowRunListProps) {
  return (
    <Card as="section" surface="opaque" className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-heading font-medium text-foreground">Recent runs</h2>
          <p className="mt-1 text-ui-sm text-muted-foreground">Managed Cloud history for this workflow.</p>
        </div>
        {error && onRetry ? <Button type="button" variant="secondary" size="sm" onClick={onRetry}>Retry</Button> : null}
      </div>
      {loading ? (
        <p className="py-4 text-ui-sm text-muted-foreground" role="status">Loading runs</p>
      ) : error ? (
        <p className="py-4 text-ui text-destructive" role="alert">{error}</p>
      ) : runs.length === 0 ? (
        <p className="py-4 text-ui-sm text-muted-foreground">No managed runs yet.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-0.5">
          {runs.map((run) => {
            const status = workflowHistoryItemPresentation(run);
            return (
              <RosterRow
                key={run.id}
                density="comfortable"
                title={`Revision ${run.definitionRevision}`}
                secondary={`${run.placementKind === "scratch" ? "Scratch workspace" : "Repository worktree"} · ${formatDateTime(run.createdAt)}`}
                trailing={(
                  <span className="flex items-center gap-1.5">
                    <StatusDot tone={workflowRunStatusDotTone(status.tone)} />
                    {status.label}
                  </span>
                )}
                onSelect={() => onSelect(run.id)}
              />
            );
          })}
        </div>
      )}
      {hasMore && onLoadMore ? (
        <Button type="button" variant="secondary" size="sm" className="mt-3" loading={loadingMore} onClick={onLoadMore}>
          Load more
        </Button>
      ) : null}
    </Card>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}
