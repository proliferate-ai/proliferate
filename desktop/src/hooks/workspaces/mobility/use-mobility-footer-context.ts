import { useMemo } from "react";
import {
  buildMobilityFooterContext,
  type WorkspaceMobilitySelectedMaterializationKind,
  type MobilityFooterContext,
} from "@/lib/domain/workspaces/mobility-footer-context";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaceMobilityState } from "./use-workspace-mobility-state";

export function useMobilityFooterContext(): MobilityFooterContext | null {
  const mobility = useWorkspaceMobilityState();
  const selectedWorkspaceId = useHarnessStore((s) => s.selectedWorkspaceId);
  const selectedMaterializationKind: WorkspaceMobilitySelectedMaterializationKind | null =
    selectedWorkspaceId
      ? parseCloudWorkspaceSyntheticId(selectedWorkspaceId) ? "cloud" : "local"
      : null;

  return useMemo(() => buildMobilityFooterContext({
    logicalWorkspace: mobility.selectedLogicalWorkspace,
    selectedMaterializationKind,
    status: mobility.status,
  }), [
    mobility.selectedLogicalWorkspace,
    mobility.status,
    selectedMaterializationKind,
  ]);
}
