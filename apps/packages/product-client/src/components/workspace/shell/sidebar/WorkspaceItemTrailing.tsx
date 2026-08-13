import type { ReactNode } from "react";
import type {
  SidebarIndicatorAction,
  SidebarStatusIndicator,
  SidebarWorkspaceVariant,
} from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";
import {
  SidebarGitConflictsAlert,
  SidebarStatusIndicatorView,
} from "#product/components/workspace/shell/sidebar/SidebarIndicators";
import {
  resolveSidebarWorkspaceGitIdentity,
  SidebarWorkspaceGitGlyph,
} from "#product/components/workspace/shell/sidebar/SidebarWorkspaceGitGlyph";

export interface WorkspaceItemTrailingCells {
  /** Null when the row has no git identity, so the cell collapses. */
  identity: ReactNode;
  /** Null when the row has nothing to report in its status cell. */
  status: ReactNode;
}

interface WorkspaceItemTrailingInput {
  gitStatus: WorkspaceGitStatus | null;
  variant: SidebarWorkspaceVariant;
  statusIndicator: SidebarStatusIndicator | null;
  onIndicatorAction?: (action: SidebarIndicatorAction) => void;
}

/**
 * Fills the workspace row's two trailing cells.
 *
 * Resolution rather than rendering: the row decides whether the identity cell
 * exists at all from the returned node being null, so this cannot be a
 * component — an always-truthy element would reserve the cell for nothing.
 */
export function resolveWorkspaceItemTrailingCells({
  gitStatus,
  variant,
  statusIndicator,
  onIndicatorAction,
}: WorkspaceItemTrailingInput): WorkspaceItemTrailingCells {
  // The identity cell exists only when there is an identity to put in it, so
  // a local row with no PR collapses the cell instead of reserving 20px for
  // nothing.
  const identity = resolveSidebarWorkspaceGitIdentity(gitStatus, variant)
    ? <SidebarWorkspaceGitGlyph status={gitStatus} variant={variant} />
    : null;
  // Right-slot precedence: live activity first, then merge conflicts (the one
  // git attention state the identity glyph's dot does not already carry).
  const status = statusIndicator ? (
    <SidebarStatusIndicatorView
      indicator={statusIndicator}
      onAction={onIndicatorAction}
    />
  ) : gitStatus?.attention === "conflicts" ? (
    <SidebarGitConflictsAlert />
  ) : null;

  return { identity, status };
}
