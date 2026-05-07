import { useCloudWorkspaceHandoffHeartbeatLoop } from "@/hooks/workspaces/mobility/use-cloud-workspace-handoff-heartbeat-loop";
import { isWorkspaceMobilityTransitionPhase } from "@/lib/domain/workspaces/mobility/mobility-state-machine";
import { useWorkspaceMobilityState } from "./use-workspace-mobility-state";

export function useWorkspaceMobilityLifecycle() {
  const state = useWorkspaceMobilityState();

  useCloudWorkspaceHandoffHeartbeatLoop({
    mobilityWorkspaceId: state.mobilityWorkspaceId,
    handoffOpId: state.mobilityWorkspaceDetail?.activeHandoff?.id
      ?? state.selectedLogicalWorkspace?.mobilityWorkspace?.activeHandoff?.id
      ?? null,
    enabled: isWorkspaceMobilityTransitionPhase(state.status.phase),
  });
}
