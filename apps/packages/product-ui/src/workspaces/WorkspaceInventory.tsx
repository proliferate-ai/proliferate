import { twMerge } from "tailwind-merge";

import { EmptyState } from "@proliferate/ui/layout/EmptyState";

import type { WorkspaceInventoryGroupView } from "@proliferate/product-domain/workspaces/inventory";

import { InventoryGroup } from "./WorkspaceInventoryGroup";

export type {
  WorkspaceInventoryGroupView,
  WorkspaceInventoryItemView,
  WorkspaceInventoryLocationKind,
  WorkspaceInventoryOwnershipKind,
  WorkspaceInventorySourceKind,
  WorkspaceInventoryStatusKind,
} from "@proliferate/product-domain/workspaces/inventory";

export interface WorkspaceInventoryProps {
  groups: readonly WorkspaceInventoryGroupView[];
  loading?: boolean;
  error?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  ariaLabel?: string;
  className?: string;
  externalOpenWorkspaceIds?: ReadonlySet<string>;
  onGroupToggle?: (groupId: string) => void;
  onWorkspaceSelect?: (workspaceId: string) => void;
}

export function WorkspaceInventory({
  groups,
  loading = false,
  error = false,
  emptyTitle = "No workspaces",
  emptyDescription = "Workspaces will appear here when they are available.",
  ariaLabel = "Workspace inventory",
  className = "",
  externalOpenWorkspaceIds,
  onGroupToggle,
  onWorkspaceSelect,
}: WorkspaceInventoryProps) {
  const itemCount = groups.reduce((sum, g) => sum + g.items.length, 0);

  if (loading) {
    return <WorkspaceInventoryLoadingState className={className} />;
  }

  if (error) {
    return (
      <EmptyState
        className={className}
        role="alert"
        title="Could not load workspaces"
        description="Refresh the page or sign in again."
      />
    );
  }

  if (itemCount === 0) {
    return (
      <EmptyState
        className={className}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <div
      className={twMerge("w-full min-w-0 overflow-hidden pb-10", className)}
      role="region"
      aria-label={ariaLabel}
    >
      {groups.map((group) => (
        <InventoryGroup
          key={group.id}
          group={group}
          externalOpenWorkspaceIds={externalOpenWorkspaceIds}
          onGroupToggle={onGroupToggle}
          onWorkspaceSelect={onWorkspaceSelect}
        />
      ))}
    </div>
  );
}

function WorkspaceInventoryLoadingState({ className }: { className?: string }) {
  return (
    <div
      className={twMerge("w-full min-w-0 overflow-hidden pb-10 pt-2", className)}
      role="status"
      aria-live="polite"
      aria-label="Loading workspaces"
    >
      <div className="flex flex-col gap-1">
        <SkeletonBlock className="h-9 w-full bg-foreground/5" />
        <SkeletonBlock className="h-9 w-[92%] bg-foreground/5" />
        <SkeletonBlock className="h-9 w-[76%] bg-foreground/5" />
      </div>
      <div className="mt-5 flex flex-col gap-1">
        <SkeletonBlock className="h-9 w-full bg-foreground/5" />
        <SkeletonBlock className="h-9 w-[84%] bg-foreground/5" />
      </div>
      <span className="sr-only">Loading workspaces</span>
    </div>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={twMerge("block rounded-md bg-muted/60 motion-safe:animate-pulse", className)}
    />
  );
}
