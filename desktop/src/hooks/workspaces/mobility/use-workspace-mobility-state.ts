import { useMemo } from "react";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useSelectedLogicalWorkspace } from "@/hooks/workspaces/use-selected-logical-workspace";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { resolveLogicalWorkspaceMaterializationId } from "@/lib/domain/workspaces/logical-workspaces";
import { resolveWorkspaceMobilityStatusModel } from "@/lib/domain/workspaces/mobility-state-machine";
import { useCloudMobilityWorkspaceDetail } from "@/hooks/cloud/use-cloud-mobility-workspace-detail";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";

export function useWorkspaceMobilityState() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { selectedLogicalWorkspace, selectedLogicalWorkspaceId, isLoading } = useSelectedLogicalWorkspace();
  const confirmSnapshot = useWorkspaceMobilityUiStore((state) => (
    selectedLogicalWorkspaceId
      ? state.confirmSnapshotByLogicalWorkspaceId[selectedLogicalWorkspaceId] ?? null
      : null
  ));
  const showMcpNotice = useWorkspaceMobilityUiStore((state) => (
    selectedLogicalWorkspaceId
      ? (state.showMcpNoticeByLogicalWorkspaceId[selectedLogicalWorkspaceId] ?? false)
        && !(state.dismissedMcpNoticeByLogicalWorkspaceId[selectedLogicalWorkspaceId] ?? false)
      : false
  ));
  const mobilityWorkspaceId = selectedLogicalWorkspace?.mobilityWorkspace?.id ?? null;
  const mobilityDetailQuery = useCloudMobilityWorkspaceDetail(mobilityWorkspaceId, !!mobilityWorkspaceId);
  const mobilityWorkspaceDetail = mobilityDetailQuery.data ?? null;

  const localWorkspaceId = selectedLogicalWorkspace?.localWorkspace?.id ?? null;
  const cloudWorkspaceId = selectedLogicalWorkspace?.cloudWorkspace?.id ?? null;
  const cloudMaterializationId = cloudWorkspaceId ? cloudWorkspaceSyntheticId(cloudWorkspaceId) : null;
  const resolvedWorkspaceId = useMemo(() => (
    selectedLogicalWorkspace
      ? resolveLogicalWorkspaceMaterializationId(selectedLogicalWorkspace, selectedWorkspaceId)
      : null
  ), [selectedLogicalWorkspace, selectedWorkspaceId]);
  const status = useMemo(() => resolveWorkspaceMobilityStatusModel(
    selectedLogicalWorkspace,
    mobilityWorkspaceDetail?.activeHandoff ?? selectedLogicalWorkspace?.mobilityWorkspace?.activeHandoff ?? null,
  ), [mobilityWorkspaceDetail?.activeHandoff, selectedLogicalWorkspace]);
  const handoffActive = Boolean(
    mobilityWorkspaceDetail?.activeHandoff
    ?? selectedLogicalWorkspace?.mobilityWorkspace?.activeHandoff
    ?? (selectedLogicalWorkspace?.lifecycle === "moving_to_cloud"
      || selectedLogicalWorkspace?.lifecycle === "moving_to_local"),
  );

  const repoBacked = Boolean(
    selectedLogicalWorkspace?.provider
    && selectedLogicalWorkspace.owner
    && selectedLogicalWorkspace.repoName,
  );
  const canMoveToCloud = repoBacked
    && selectedLogicalWorkspace?.effectiveOwner === "local"
    && !!localWorkspaceId;
  const canBringBackLocal = repoBacked
    && selectedLogicalWorkspace?.effectiveOwner === "cloud"
    && !!selectedLogicalWorkspace.repoRoot?.id;

  return {
    selectedLogicalWorkspace,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    resolvedWorkspaceId,
    localWorkspaceId,
    cloudWorkspaceId,
    cloudMaterializationId,
    mobilityWorkspaceId,
    mobilityWorkspaceDetail,
    status,
    repoBacked,
    canMoveToCloud,
    canBringBackLocal,
    handoffActive,
    selectionLocked: handoffActive,
    confirmSnapshot,
    showMcpNotice,
    isLoading: isLoading || mobilityDetailQuery.isLoading,
  };
}
