import {
  workflowHistoryItemPresentation,
  type WorkflowRunHistoryItem,
} from "@proliferate/product-domain/workflows/run-presentation";
import { Button } from "@proliferate/ui/primitives/Button";

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
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Recent runs</h2>
          <p className="mt-1 text-xs text-muted-foreground">Managed Cloud history for this workflow.</p>
        </div>
        {error && onRetry ? <Button type="button" variant="secondary" size="sm" onClick={onRetry}>Retry</Button> : null}
      </div>
      {loading ? (
        <p className="py-4 text-xs text-muted-foreground" role="status">Loading runs</p>
      ) : error ? (
        <p className="py-4 text-xs text-destructive" role="alert">{error}</p>
      ) : runs.length === 0 ? (
        <p className="py-4 text-xs text-muted-foreground">No managed runs yet.</p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-md border border-border">
          {runs.map((run, index) => {
            const status = workflowHistoryItemPresentation(run);
            return (
              <Button
                key={run.id}
                type="button"
                variant="unstyled"
                size="unstyled"
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-list-hover ${index > 0 ? "border-t border-border" : ""}`}
                onClick={() => onSelect(run.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">Revision {run.definitionRevision}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {run.placementKind === "scratch" ? "Scratch workspace" : "Repository worktree"} · {formatDateTime(run.createdAt)}
                  </span>
                </span>
                <span className={`shrink-0 text-xs ${toneClass(status.tone)}`}>{status.label}</span>
              </Button>
            );
          })}
        </div>
      )}
      {hasMore && onLoadMore ? (
        <Button type="button" variant="secondary" size="sm" className="mt-3" loading={loadingMore} onClick={onLoadMore}>
          Load more
        </Button>
      ) : null}
    </section>
  );
}

function toneClass(tone: string): string {
  if (tone === "danger") return "text-destructive";
  if (tone === "warning") return "text-warning";
  if (tone === "success") return "text-success";
  return "text-muted-foreground";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}
