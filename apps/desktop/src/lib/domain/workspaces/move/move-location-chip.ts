import { parseTargetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";

/** The three-way location split a workspace id resolves to. Domain-owned so pure
 *  modules can classify without reaching into lib/access; the access layer's
 *  `RuntimeTarget.location` references this same union. */
export type WorkspaceRuntimeLocation = "local" | "cloud" | "target";

export interface WorkspaceLocationChipView {
  location: WorkspaceRuntimeLocation;
  label: string;
  /** Local and cloud workspaces can both open the move dialog (spec section 2.6,
   *  "Direction inference at the entry points" -- the dialog itself resolves which
   *  direction from the workspace id, spec section 2.3's two flows); target (SSH)
   *  chips stay a read-only badge until SSH moves land (M3). */
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
    clickable: location === "local" || location === "cloud",
  };
}
