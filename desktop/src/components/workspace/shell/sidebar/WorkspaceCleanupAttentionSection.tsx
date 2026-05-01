import type { Workspace } from "@anyharness/sdk";
import {
  CircleAlert,
  RefreshCw,
} from "@/components/ui/icons";
import { workspaceDisplayName } from "@/lib/domain/workspaces/workspace-display";
import { SidebarActionButton } from "./SidebarActionButton";
import { SidebarRowSurface } from "./SidebarRowSurface";

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
    <div className="flex flex-col gap-px pb-2">
      <div className="pl-2 pt-3 pb-1 text-base text-foreground/50 opacity-75">
        Cleanup
      </div>
      {workspaces.map((workspace) => (
        <SidebarRowSurface
          key={workspace.id}
          className="min-h-[34px] px-2 py-1 gap-1.5 text-sm leading-4 focus-visible:outline-offset-[-2px]"
        >
          <div className="flex w-4 shrink-0 items-center justify-center">
            <CircleAlert className="size-3 text-destructive" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base leading-5 text-foreground">
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
  );
}
