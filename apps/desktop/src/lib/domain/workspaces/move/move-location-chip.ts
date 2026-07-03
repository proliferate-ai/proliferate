import { parseTargetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";

/** The three-way location split a workspace id resolves to. Domain-owned so pure
 *  modules can classify without reaching into lib/access; the access layer's
 *  `RuntimeTarget.location` references this same union. */
export type WorkspaceRuntimeLocation = "local" | "cloud" | "target";

export interface WorkspaceLocationChipView {
  location: WorkspaceRuntimeLocation;
  label: string;
  /** Only local workspaces can open the move-to-cloud dialog in this PR (local->cloud
   *  only, spec section 0's "local<->E2B only" v1 gate); cloud/target chips render as a
   *  read-only badge until the mirror direction (PR D) and SSH targets (M3) land. */
  clickable: boolean;
}

const LOCATION_LABELS: Record<WorkspaceRuntimeLocation, string> = {
  local: "This Mac",
  cloud: "Cloud",
  target: "Remote target",
};

/**
 * Cheap, synchronous classification of a workspace's location from its id shape alone
 * -- the same three-way split `resolveRuntimeTargetForWorkspace` makes, without that
 * function's async cloud-workspace-detail fetch (unneeded just to label a chip).
 */
export function resolveWorkspaceLocationChip(
  workspaceId: string | null,
  isCloudWorkspaceSelected: boolean,
): WorkspaceLocationChipView | null {
  if (!workspaceId) return null;
  const location: WorkspaceRuntimeLocation = isCloudWorkspaceSelected
    ? "cloud"
    : parseTargetWorkspaceSyntheticId(workspaceId)
      ? "target"
      : "local";
  return {
    location,
    label: LOCATION_LABELS[location],
    clickable: location === "local",
  };
}
