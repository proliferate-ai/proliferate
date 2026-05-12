import { useMemo } from "react";
import {
  buildPendingMobilityFooterContext,
  buildMobilityFooterContext,
  type WorkspaceMobilitySelectedMaterializationKind,
  type MobilityFooterContext,
} from "@/lib/domain/workspaces/mobility/mobility-footer-context";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { buildPendingWorkspaceUiKey } from "@/lib/domain/workspaces/creation/pending-entry";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceMobilityState } from "./use-workspace-mobility-state";

export function useMobilityFooterContext(): MobilityFooterContext | null {
  const mobility = useWorkspaceMobilityState();
  const selectedWorkspaceId = useSessionSelectionStore((s) => s.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((s) => s.selectedLogicalWorkspaceId);
  const pendingWorkspaceEntry = useSessionSelectionStore((s) => s.pendingWorkspaceEntry);
  const selectedMaterializationKind: WorkspaceMobilitySelectedMaterializationKind | null =
    selectedWorkspaceId
      ? parseCloudWorkspaceSyntheticId(selectedWorkspaceId) ? "cloud" : "local"
      : null;

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
    });
  }, [
    mobility.selectedLogicalWorkspace,
    mobility.status,
    pendingWorkspaceEntry,
    selectedLogicalWorkspaceId,
    selectedMaterializationKind,
  ]);
}
