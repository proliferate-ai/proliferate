import { useMemo } from "react";
import type { Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceStatusScreenModel } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";
import {
  buildCloudWorkspaceStatusScreenModel,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";
import {
  isCloudWorkspacePostReadyPending,
  resolveCloudWorkspaceStatus,
  shouldShowCloudWorkspaceStatusScreen,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-status";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import {
  canRestoreMissingWorktree,
  isWorkspaceDirectoryMissing,
} from "#product/lib/domain/workspaces/availability";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useAttendedPendingWorkspaceEntry } from "#product/hooks/workspaces/derived/use-pending-workspace-entries";
import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";

export type WorkspaceStatusPanelState =
  | {
    /**
     * Cloud/cowork provisioning only — local and worktree creations render
     * the workspace-creation transcript receipt instead (see
     * `use-workspace-creation-receipt.ts`).
     */
    kind: "pending";
    entry: PendingWorkspaceEntry;
    badgeLabel: string;
    title: string;
    subtitle: string;
    detail: string | null;
    isFailed: boolean;
    workspacePath: string | null;
    sourceRepoRootPath: string | null;
  }
  | {
    kind: "cloud-status";
    workspaceId: string;
    model: CloudWorkspaceStatusScreenModel;
  }
  | {
    /**
     * The workspace's local checkout was removed from disk. Persistent and
     * non-dismissible while the directory is gone; chat history stays
     * readable but agents, files, and terminals cannot run.
     */
    kind: "directory-missing";
    workspaceId: string;
    logicalWorkspaceId: string | null;
    workspaceKind: Workspace["kind"];
    workspacePath: string;
    currentBranch: string | null;
    restoreEligible: boolean;
  };

function isPanelPendingSource(entry: PendingWorkspaceEntry | null): entry is PendingWorkspaceEntry {
  // Local and worktree creations render the transcript receipt instead of
  // this attached panel.
  return !!entry
    && (entry.source === "cloud-created" || entry.source === "cowork-created");
}

function buildPendingSubtitle(entry: PendingWorkspaceEntry): string {
  if (entry.stage === "failed") {
    return entry.errorMessage ?? "Workspace setup failed.";
  }

  if (entry.stage === "awaiting-cloud-ready") {
    return "Provisioning cloud workspace...";
  }

  switch (entry.source) {
    case "local-created":
      return "Creating workspace...";
    case "worktree-created":
      return "Creating worktree...";
    case "cloud-created":
      return "Creating cloud workspace...";
    case "cowork-created":
      return "Starting cowork thread...";
  }
}

function buildPendingBadge(entry: PendingWorkspaceEntry): string {
  if (entry.stage === "failed") {
    return "Failed";
  }

  if (entry.stage === "awaiting-cloud-ready" || entry.source === "cloud-created") {
    return "Provisioning";
  }

  return "Setting up";
}

function buildPendingDetail(entry: PendingWorkspaceEntry): string | null {
  return [
    entry.repoLabel,
    entry.baseBranchName ? `from ${entry.baseBranchName}` : null,
  ]
    .filter(Boolean)
    .join(" · ") || null;
}

// Owns the read-only workspace status panel state shown above the composer.
// User actions for the panel live in workspaces/workflows.
export function useWorkspaceStatusPanelState(): WorkspaceStatusPanelState | null {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const pendingWorkspaceEntry = useAttendedPendingWorkspaceEntry();
  const { data: workspaceCollections } = useWorkspaces();
  const pendingSourceRepoRootPath = useMemo(() => {
    if (!pendingWorkspaceEntry) {
      return null;
    }
    const { request } = pendingWorkspaceEntry;
    if (request.kind === "local") {
      return request.sourceRoot;
    }
    if (request.kind !== "worktree") {
      return null;
    }
    return workspaceCollections?.repoRoots.find(
      (repoRoot) => repoRoot.id === request.input.repoRootId,
    )?.path ?? null;
  }, [pendingWorkspaceEntry, workspaceCollections?.repoRoots]);
  const selectedWorkspace = workspaceCollections?.workspaces.find(
    (workspace) => workspace.id === selectedWorkspaceId,
  ) ?? null;
  const selectedRepoRoot = selectedWorkspace
    ? workspaceCollections?.repoRoots.find((repoRoot) => repoRoot.id === selectedWorkspace.repoRootId)
      ?? null
    : null;

  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const selectedCloudWorkspace = workspaceCollections?.cloudWorkspaces.find(
    (workspace) => workspace.id === selectedCloudWorkspaceId,
  ) ?? null;

  return useMemo(() => {
    const staleCloudReadyPendingEntry = Boolean(
      pendingWorkspaceEntry
      && pendingWorkspaceEntry.stage === "awaiting-cloud-ready"
      && pendingWorkspaceEntry.workspaceId === selectedWorkspaceId
      && selectedCloudWorkspace
      && resolveCloudWorkspaceStatus(selectedCloudWorkspace) === "ready"
      && !isCloudWorkspacePostReadyPending(selectedCloudWorkspace),
    );

    if (
      pendingWorkspaceEntry
      && isPanelPendingSource(pendingWorkspaceEntry)
      && !staleCloudReadyPendingEntry
    ) {
      return {
        kind: "pending",
        entry: pendingWorkspaceEntry,
        badgeLabel: buildPendingBadge(pendingWorkspaceEntry),
        title: pendingWorkspaceEntry.displayName,
        subtitle: buildPendingSubtitle(pendingWorkspaceEntry),
        detail: buildPendingDetail(pendingWorkspaceEntry),
        isFailed: pendingWorkspaceEntry.stage === "failed",
        workspacePath: pendingWorkspaceEntry.request.kind === "local"
          ? pendingWorkspaceEntry.request.sourceRoot
          : pendingWorkspaceEntry.request.kind === "worktree"
            ? pendingWorkspaceEntry.request.input.targetPath?.trim() || null
            : null,
        sourceRepoRootPath: pendingSourceRepoRootPath,
      };
    }

    // Detected on workspace load/select via the collections query — not only
    // when a send fails. Outranks the cloud-status screen: nothing else
    // about the workspace is actionable while the checkout is gone.
    if (
      selectedWorkspaceId
      && selectedWorkspace
      && isWorkspaceDirectoryMissing(selectedWorkspace)
    ) {
      return {
        kind: "directory-missing",
        workspaceId: selectedWorkspaceId,
        logicalWorkspaceId: selectedLogicalWorkspaceId,
        workspaceKind: selectedWorkspace.kind,
        workspacePath: selectedWorkspace.path,
        currentBranch: selectedWorkspace.currentBranch ?? null,
        restoreEligible: canRestoreMissingWorktree(selectedWorkspace, selectedRepoRoot),
      };
    }

    if (
      selectedWorkspaceId
      && selectedCloudWorkspace
      && shouldShowCloudWorkspaceStatusScreen(selectedCloudWorkspace)
    ) {
      return {
        kind: "cloud-status",
        workspaceId: selectedWorkspaceId,
        model: buildCloudWorkspaceStatusScreenModel(selectedCloudWorkspace, null),
      };
    }

    return null;
  }, [
    pendingSourceRepoRootPath,
    pendingWorkspaceEntry,
    selectedCloudWorkspace,
    selectedLogicalWorkspaceId,
    selectedRepoRoot,
    selectedWorkspace,
    selectedWorkspaceId,
  ]);
}
