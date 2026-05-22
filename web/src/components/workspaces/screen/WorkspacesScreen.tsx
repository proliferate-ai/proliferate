import { Cloud, GitBranch, RefreshCw, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useCloudWorkspaces } from "@proliferate/cloud-sdk-react";

import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Button } from "@proliferate/ui/primitives/Button";

import { routes } from "../../../config/routes";

export function WorkspacesScreen() {
  const workspaces = useCloudWorkspaces({ scope: "my" });

  return (
    <ProductPageShell
      title="Cloud sandboxes"
      description="Workspaces available to Web, Mobile, and shared cloud flows."
      actions={
        <Button variant="secondary" size="md" onClick={() => void workspaces.refetch()}>
          <RefreshCw size={15} />
          Refresh
        </Button>
      }
      telemetryBlocked
    >
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
            <Link
              key={workspace.id}
              to={routes.workspace(workspace.id)}
              className="rounded-lg border border-border bg-card p-4 text-left transition hover:border-ring/50 hover:bg-accent/30"
            >
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
                <div className="flex flex-wrap justify-end gap-2">
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
                    {workspace.exposureState ?? "tracked"}
                  </span>
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
                    {workspace.status}
                  </span>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1">
                  <GitBranch size={13} />
                  {workspace.repo.branch ?? workspace.repo.baseBranch ?? "main"}
                </span>
                {workspace.visibility !== "private" && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1">
                    <Users size={13} />
                    {workspace.visibility === "shared_unclaimed"
                      ? "Unclaimed"
                      : workspace.visibility}
                  </span>
                )}
                <span className="rounded-md border border-border px-2 py-1">
                  {workspace.origin?.kind ?? "personal"}
                </span>
                {workspace.lastSessionSummary && (
                  <span className="rounded-md border border-border px-2 py-1">
                    {workspace.lastSessionSummary.title ?? workspace.lastSessionSummary.status}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No cloud workspaces"
          description="Create a workspace from Home, Desktop, or the cloud setup flow."
        />
      )}
    </ProductPageShell>
  );
}
