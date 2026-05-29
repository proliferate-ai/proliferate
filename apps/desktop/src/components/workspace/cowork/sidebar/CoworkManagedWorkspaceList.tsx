import type { CoworkManagedWorkspaceSummary } from "@anyharness/sdk";
import { SkeletonBlock } from "@/components/feedback/Skeleton";
import { SidebarRowSurface } from "@/components/ui/SidebarRowSurface";

function workspaceLabel(workspace: CoworkManagedWorkspaceSummary, index: number): string {
  return workspace.label?.trim()
    || `Coding workspace ${workspace.ownershipId.slice(0, 8) || index + 1}`;
}

function CoworkManagedWorkspaceBlock({
  workspace,
  index,
  selectedWorkspaceId,
  onOpenWorkspace,
}: {
  workspace: CoworkManagedWorkspaceSummary;
  index: number;
  selectedWorkspaceId: string | null;
  onOpenWorkspace: (workspaceId: string) => void;
}) {
  const isActive = selectedWorkspaceId === workspace.workspaceId;
  return (
    <div className="min-w-0" data-telemetry-mask="true">
      <SidebarRowSurface
        active={isActive}
        onPress={() => onOpenWorkspace(workspace.workspaceId)}
        className="h-[30px] pl-2 pr-1 py-1 focus-visible:outline-offset-[-2px]"
      >
        <div className="flex w-full items-center gap-1.5 text-sm leading-4">
          <div className="flex w-4 shrink-0 items-center justify-center" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-4">
            <span className="min-w-0 flex-1 truncate text-base leading-5 text-sidebar-foreground">
              {workspaceLabel(workspace, index)}
            </span>
          </div>
        </div>
      </SidebarRowSurface>
    </div>
  );
}

interface CoworkManagedWorkspaceListProps {
  workspaces: CoworkManagedWorkspaceSummary[];
  isLoading: boolean;
  selectedWorkspaceId: string | null;
  onOpenWorkspace: (workspaceId: string) => void;
}

export function CoworkManagedWorkspaceList({
  workspaces,
  isLoading,
  selectedWorkspaceId,
  onOpenWorkspace,
}: CoworkManagedWorkspaceListProps) {
  if (isLoading) {
    return (
      <div className="flex h-[30px] items-center gap-2 pl-6 pr-2" aria-label="Loading coding workspaces" role="status">
        <SkeletonBlock className="h-3 w-36 bg-sidebar-accent" />
        <span className="sr-only">Loading coding workspaces</span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      {workspaces.map((workspace, index) => (
        <CoworkManagedWorkspaceBlock
          key={workspace.ownershipId}
          workspace={workspace}
          index={index}
          selectedWorkspaceId={selectedWorkspaceId}
          onOpenWorkspace={onOpenWorkspace}
        />
      ))}
    </div>
  );
}
