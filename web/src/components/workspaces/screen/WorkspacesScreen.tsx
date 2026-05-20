import { RefreshCw } from "lucide-react";
import { useCloudWorkspaces } from "@proliferate/cloud-sdk-react";

import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import { CloudWorkspaceList } from "@proliferate/product-ui/workspaces/CloudWorkspaceList";
import { Button } from "@proliferate/ui/primitives/Button";

export function WorkspacesScreen() {
  const workspaces = useCloudWorkspaces();

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
      <CloudWorkspaceList
        loading={workspaces.isLoading}
        error={Boolean(workspaces.error)}
        items={(workspaces.data ?? []).map((workspace) => ({
          id: workspace.id,
          name: workspace.displayName ?? workspace.repo.name,
          repoLabel: `${workspace.repo.owner}/${workspace.repo.name}`,
          branchLabel: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
          originLabel: workspace.origin?.kind ?? "personal",
          statusLabel: workspace.status,
        }))}
      />
    </ProductPageShell>
  );
}
