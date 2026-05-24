import { useMemo } from "react";
import {
  buildPendingMobilityFooterContext,
  buildMobilityFooterContext,
  workspaceMobilitySelectedMaterializationKindFromWorkspaceId,
  type MobilityFooterContext,
} from "@/lib/domain/workspaces/mobility/mobility-footer-context";
import { useComputeTargetOptions } from "@/hooks/compute/derived/use-compute-target-options";
import { buildPendingWorkspaceUiKey } from "@/lib/domain/workspaces/creation/pending-entry";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceMobilityState } from "./use-workspace-mobility-state";

export function useMobilityFooterContext(): MobilityFooterContext | null {
  const mobility = useWorkspaceMobilityState();
  const selectedWorkspaceId = useSessionSelectionStore((s) => s.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((s) => s.selectedLogicalWorkspaceId);
  const pendingWorkspaceEntry = useSessionSelectionStore((s) => s.pendingWorkspaceEntry);
  const computeTargets = useComputeTargetOptions({
    enabled: Boolean(mobility.selectedLogicalWorkspace),
  });
  const selectedMaterializationKind =
    workspaceMobilitySelectedMaterializationKindFromWorkspaceId(selectedWorkspaceId);

  return useMemo(() => {
    if (
      pendingWorkspaceEntry
      && selectedLogicalWorkspaceId === buildPendingWorkspaceUiKey(pendingWorkspaceEntry)
    ) {
      return buildPendingMobilityFooterContext(pendingWorkspaceEntry);
    }

    return buildMobilityFooterContext({
      logicalWorkspace: mobility.selectedLogicalWorkspace,
      selectedMaterializationKind,
      status: mobility.status,
      targetAppearanceById: computeTargets.targetAppearanceById,
    });
  }, [
    computeTargets.targetAppearanceById,
    mobility.selectedLogicalWorkspace,
    mobility.status,
    pendingWorkspaceEntry,
    selectedLogicalWorkspaceId,
    selectedMaterializationKind,
  ]);
}
