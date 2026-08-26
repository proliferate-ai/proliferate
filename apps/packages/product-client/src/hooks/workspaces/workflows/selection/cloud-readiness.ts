import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import type { CloudReadinessResult, WorkspaceSelectionContext } from "#product/hooks/workspaces/workflows/selection/types";

/**
 * The cloud workspace stack is deleted, so a synthetic cloud id can only be a
 * stale cache remnant with no workspace behind it: it resolves `cloud-missing`
 * without a lookup. Every real workspace id is a local-runtime selection.
 */
export async function resolveCloudWorkspaceReadiness(
  context: WorkspaceSelectionContext,
): Promise<CloudReadinessResult> {
  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(context.workspaceId);
  if (!cloudWorkspaceId) {
    return { kind: "local" };
  }
  return { kind: "cloud-missing", cloudWorkspaceId };
}
