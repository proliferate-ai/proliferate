import type { Workspace } from "@anyharness/sdk";
import {
  CircleAlert,
  RefreshCw,
} from "@proliferate/ui/icons";
import { workspaceDisplayName } from "@/lib/domain/workspaces/display/workspace-display";
import { SidebarActionButton } from "@proliferate/ui/layout/SidebarActionButton";
import { SidebarRowSurface } from "@proliferate/ui/layout/SidebarRowSurface";
import { ProductSidebarSectionHeader } from "@proliferate/product-ui/sidebar/ProductSidebarLayout";

interface WorkspaceCleanupAttentionSectionProps {
  workspaces: Workspace[];
  onRetryCleanup: (workspaceId: string) => void;
}

export function WorkspaceCleanupAttentionSection({
  workspaces,
  onRetryCleanup,
}: WorkspaceCleanupAttentionSectionProps) {
  if (workspaces.length === 0) {
    return null;
  }

  return (
    <div className="pb-2">
      <ProductSidebarSectionHeader label="Cleanup" />
      <div className="flex flex-col gap-px">
        {workspaces.map((workspace) => (
          <SidebarRowSurface
            key={workspace.id}
            className="min-h-[34px] px-2 py-1 gap-1.5 text-sm leading-4 focus-visible:outline-offset-[-2px]"
          >
            <div className="flex w-4 shrink-0 items-center justify-center">
              <CircleAlert className="size-3 text-destructive" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-ui leading-5 text-current">
                {workspaceDisplayName(workspace)}
              </span>
              <span className="truncate text-xs leading-4 text-sidebar-muted-foreground">
                {workspace.cleanupErrorMessage?.trim() || "Cleanup did not finish."}
              </span>
            </div>
            <SidebarActionButton
              title="Retry cleanup"
              onClick={(event) => {
                event.stopPropagation();
                onRetryCleanup(workspace.id);
              }}
              className="size-6"
              alwaysVisible
            >
              <RefreshCw className="size-3" />
            </SidebarActionButton>
          </SidebarRowSurface>
        ))}
      </div>
    </div>
  );
}
