import { useCallback, useState } from "react";
import { cloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import type { SidebarGroupState } from "#product/lib/domain/workspaces/sidebar/sidebar-model";
import { useCloudWorkspaceActions } from "#product/hooks/cloud/workflows/use-cloud-workspace-actions";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

interface ArchiveConfirmationState {
  workspaceId: string;
  cloudWorkspaceId: string | null;
  name: string;
}

/**
 * Owns the sidebar's archive/unarchive flow: the confirmation-dialog state,
 * routing local archives to the UI store and cloud archives to the Cloud
 * request, and leaving the workspace first when the archived one is selected.
 */
export function useWorkspaceSidebarArchiveActions({
  groups,
  selectedWorkspaceId,
  selectedLogicalWorkspaceId,
  onLeaveWorkspace,
}: {
  groups: SidebarGroupState[];
  selectedWorkspaceId: string | null;
  selectedLogicalWorkspaceId: string | null;
  onLeaveWorkspace: () => void;
}) {
  const [archiveConfirmation, setArchiveConfirmation] =
    useState<ArchiveConfirmationState | null>(null);
  const archiveWorkspace = useWorkspaceUiStore((s) => s.archiveWorkspace);
  const unarchiveWorkspace = useWorkspaceUiStore((s) => s.unarchiveWorkspace);
  const showToast = useToastStore((state) => state.show);
  const {
    archiveCloudWorkspace: archiveCloudWorkspaceRequest,
    restoreCloudWorkspace: restoreCloudWorkspaceRequest,
  } = useCloudWorkspaceActions();

  const resolveArchiveTargetForSidebarItem = useCallback((
    workspaceId: string,
  ): ArchiveConfirmationState => {
    for (const group of groups) {
      const item = group.items.find((candidate) => candidate.id === workspaceId);
      if (item) {
        return {
          workspaceId,
          cloudWorkspaceId: item.cloudWorkspaceId,
          name: item.name,
        };
      }
    }
    return {
      workspaceId,
      cloudWorkspaceId: null,
      name: "this workspace",
    };
  }, [groups]);

  const handleArchiveWorkspace = useCallback((workspaceId: string) => {
    setArchiveConfirmation(resolveArchiveTargetForSidebarItem(workspaceId));
  }, [resolveArchiveTargetForSidebarItem]);

  const closeArchiveConfirmation = useCallback(() => {
    setArchiveConfirmation(null);
  }, []);

  const confirmArchiveWorkspace = useCallback(() => {
    const target = archiveConfirmation;
    if (!target) {
      return;
    }
    setArchiveConfirmation(null);
    const shouldLeaveWorkspace = selectedLogicalWorkspaceId === target.workspaceId
      || selectedWorkspaceId === target.workspaceId
      || (
        target.cloudWorkspaceId
        ? selectedWorkspaceId === cloudWorkspaceSyntheticId(target.cloudWorkspaceId)
        : false
      );
    const cloudWorkspaceId = target.cloudWorkspaceId;
    if (!cloudWorkspaceId) {
      archiveWorkspace(target.workspaceId);
      if (shouldLeaveWorkspace) {
        onLeaveWorkspace();
      }
      return;
    }
    if (shouldLeaveWorkspace) {
      onLeaveWorkspace();
    }
    void archiveCloudWorkspaceRequest(cloudWorkspaceId)
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to archive workspace.";
        showToast(message);
      });
  }, [
    archiveConfirmation,
    archiveWorkspace,
    archiveCloudWorkspaceRequest,
    onLeaveWorkspace,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    showToast,
  ]);

  const handleUnarchiveWorkspace = useCallback((workspaceId: string) => {
    const cloudWorkspaceId = resolveArchiveTargetForSidebarItem(workspaceId).cloudWorkspaceId;
    if (!cloudWorkspaceId) {
      unarchiveWorkspace(workspaceId);
      return;
    }
    void restoreCloudWorkspaceRequest(cloudWorkspaceId).catch((error) => {
      const message = error instanceof Error ? error.message : "Failed to restore workspace.";
      showToast(message);
    });
  }, [
    resolveArchiveTargetForSidebarItem,
    restoreCloudWorkspaceRequest,
    showToast,
    unarchiveWorkspace,
  ]);

  return {
    archiveConfirmation,
    closeArchiveConfirmation,
    confirmArchiveWorkspace,
    handleArchiveWorkspace,
    handleUnarchiveWorkspace,
  };
}
