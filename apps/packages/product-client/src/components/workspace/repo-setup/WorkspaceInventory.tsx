import { twMerge } from "#product/primitives/utils/tw-merge";

import { EmptyState } from "#product/primitives/patterns/EmptyState";
import {
  LoadingBoundary,
  type LoadingBoundaryState,
} from "#product/primitives/LoadingBoundary";

import type { WorkspaceInventoryGroupView } from "#product/domain/workspaces/inventory";

import { InventoryGroup } from "./WorkspaceInventoryGroup";

export type {
  WorkspaceInventoryGroupView,
  WorkspaceInventoryItemView,
  WorkspaceInventoryLocationKind,
  WorkspaceInventoryOwnershipKind,
  WorkspaceInventorySourceKind,
  WorkspaceInventoryStatusKind,
} from "#product/domain/workspaces/inventory";

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

  // Error is a resolved outcome distinct from `empty`; it renders directly
  // rather than through the loading gate.
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

  // Class C big-surface treatment (UX Latency + Transitions ADR §4 Rung 4,
  // FR-1): this inventory retired its placeholder-row skeleton. While pending
  // the boundary shows nothing until the Class C show-delay window, and the
  // "No workspaces" empty state may only render after the fetch resolves
  // (`state="empty"`), never as a default while still loading (Q19 empty
  // split).
  const state: LoadingBoundaryState = loading
    ? "pending"
    : itemCount === 0
      ? "empty"
      : "ready";

  return (
    <LoadingBoundary
      state={state}
      diagnostics={{ flow: "workspace_inventory" }}
      treatment={null}
      emptyContent={
        <EmptyState
          className={className}
          title={emptyTitle}
          description={emptyDescription}
        />
      }
    >
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
    </LoadingBoundary>
  );
}
