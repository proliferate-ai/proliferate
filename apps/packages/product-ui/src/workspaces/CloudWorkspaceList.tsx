import { Cloud, GitBranch } from "lucide-react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { SkeletonBlock, shimmerDelay } from "@proliferate/ui/primitives/Skeleton";

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
      <div
        className="grid gap-3"
        role="status"
        aria-live="polite"
        aria-label="Loading workspaces"
      >
        <WorkspaceListSkeletonRow />
        <WorkspaceListSkeletonRow widthClassName="w-[88%]" />
        <span className="sr-only">Loading workspaces</span>
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
    <div className="grid gap-3 animate-content-fade-in">
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

function WorkspaceListSkeletonRow({ widthClassName = "w-full" }: { widthClassName?: string }) {
  return (
    <div className={twMerge("rounded-lg bg-foreground/5 p-4", widthClassName)}>
      <div className="flex items-center gap-2">
        <SkeletonBlock className="size-8 rounded-md" style={shimmerDelay(0)} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <SkeletonBlock className="h-2 w-40" style={shimmerDelay(1)} />
          <SkeletonBlock className="h-2 w-28 bg-muted/45" style={shimmerDelay(2)} />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <SkeletonBlock className="h-6 w-24 bg-muted/45" style={shimmerDelay(3)} />
        <SkeletonBlock className="h-6 w-20 bg-muted/45" style={shimmerDelay(4)} />
      </div>
    </div>
  );
}
