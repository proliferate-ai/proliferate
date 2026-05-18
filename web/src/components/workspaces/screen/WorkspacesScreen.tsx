import { Cloud, GitBranch, RefreshCw } from "lucide-react";
import { useCloudWorkspaces } from "@proliferate/cloud-sdk-react";

import { Button } from "@proliferate/ui/primitives/Button";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";

export function WorkspacesScreen() {
  const workspaces = useCloudWorkspaces();

  return (
    <div className="web-scrollbar h-full overflow-y-auto px-8 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Workspaces</p>
          <h1 className="mt-2 text-2xl font-semibold">Cloud sandboxes</h1>
        </div>
        <Button variant="secondary" size="md" onClick={() => void workspaces.refetch()}>
          <RefreshCw size={15} />
          Refresh
        </Button>
      </header>

      {workspaces.isLoading ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Loading workspaces
        </div>
      ) : workspaces.error ? (
        <EmptyState
          title="Could not load workspaces"
          description="Refresh the page or sign in again."
        />
      ) : workspaces.data?.length ? (
        <div className="grid gap-3">
          {workspaces.data.map((workspace) => (
            <article key={workspace.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-md bg-accent text-foreground">
                      <Cloud size={15} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">
                        {workspace.displayName ?? workspace.repo.name}
                      </h2>
                      <p className="truncate text-xs text-muted-foreground">
                        {workspace.repo.owner}/{workspace.repo.name}
                      </p>
                    </div>
                  </div>
                </div>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
                  {workspace.status}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1">
                  <GitBranch size={13} />
                  {workspace.repo.branch ?? workspace.repo.baseBranch ?? "main"}
                </span>
                <span className="rounded-md border border-border px-2 py-1">
                  {workspace.origin?.kind ?? "personal"}
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No cloud workspaces"
          description="Create a workspace from Desktop or the cloud setup flow."
        />
      )}
    </div>
  );
}
