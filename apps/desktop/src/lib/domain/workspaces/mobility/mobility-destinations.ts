import type { ComputeLaunchTargetOption } from "@/lib/domain/compute/target-options";
import type {
  WorkspaceMobilityDirection,
  WorkspaceMobilityLocationKind,
} from "@/lib/domain/workspaces/mobility/types";

export type WorkspaceMobilityDestinationKind =
  | WorkspaceMobilityLocationKind
  | "ssh_target";

export type WorkspaceMobilityDestinationId =
  | "local_workspace"
  | "local_worktree"
  | "cloud_workspace"
  | `ssh:${string}`;

export interface WorkspaceMobilityDestinationOption {
  id: WorkspaceMobilityDestinationId;
  kind: WorkspaceMobilityDestinationKind;
  label: string;
  detail: string;
  disabledReason: string | null;
  direction: WorkspaceMobilityDirection | null;
  targetOption?: ComputeLaunchTargetOption | null;
}

export function buildWorkspaceMobilityDestinationOptions(input: {
  locationKind: WorkspaceMobilityLocationKind;
  sshTargets?: readonly ComputeLaunchTargetOption[] | null;
}): WorkspaceMobilityDestinationOption[] {
  const options: WorkspaceMobilityDestinationOption[] = [];

  if (input.locationKind === "cloud_workspace") {
    options.push({
      id: "local_workspace",
      kind: "local_workspace",
      label: "Local workspace",
      detail: "Bring this workspace back to your local repo.",
      disabledReason: null,
      direction: "cloud_to_local",
    });
  } else {
    options.push({
      id: "cloud_workspace",
      kind: "cloud_workspace",
      label: "Cloud workspace",
      detail: "Move this workspace to a personal cloud sandbox.",
      disabledReason: null,
      direction: "local_to_cloud",
    });
  }

  for (const target of input.sshTargets ?? []) {
    options.push({
      id: `ssh:${target.id}`,
      kind: "ssh_target",
      label: target.label,
      detail: target.detail,
      disabledReason: target.disabledReason ?? "SSH workspace moves are not wired yet.",
      direction: null,
      targetOption: target,
    });
  }

  return options;
}
