import { Cloud, GitBranch } from "lucide-react";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Badge } from "@proliferate/ui/primitives/Badge";

export interface CloudWorkspaceItemView {
  id: string;
  name: string;
  repoLabel: string;
  branchLabel: string;
  originLabel: string;
  statusLabel: string;
}

interface CloudWorkspaceListProps {
  items: CloudWorkspaceItemView[];
  loading?: boolean;
  error?: boolean;
}

export function CloudWorkspaceList({
  items,
  loading = false,
  error = false,
}: CloudWorkspaceListProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Loading workspaces
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        title="Could not load workspaces"
        description="Refresh the page or sign in again."
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No cloud workspaces"
        description="Create a workspace from Desktop or the cloud setup flow."
      />
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((workspace) => (
        <article key={workspace.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-md bg-accent text-foreground">
                  <Cloud size={15} />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{workspace.name}</h2>
                  <p className="truncate text-xs text-muted-foreground">{workspace.repoLabel}</p>
                </div>
              </div>
            </div>
            <Badge>{workspace.statusLabel}</Badge>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1">
              <GitBranch size={13} />
              {workspace.branchLabel}
            </span>
            <span className="rounded-md border border-border px-2 py-1">
              {workspace.originLabel}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}
