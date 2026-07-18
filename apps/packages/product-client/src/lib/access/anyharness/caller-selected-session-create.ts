import { parseTargetWorkspaceSyntheticId } from "#product/lib/domain/compute/target-workspace-id";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";

/** Only the bundled local runtime is deployed in lockstep with ProductClient. */
export function supportsCallerSelectedSessionCreate(workspaceId: string): boolean {
  return parseCloudWorkspaceSyntheticId(workspaceId) === null
    && parseTargetWorkspaceSyntheticId(workspaceId) === null;
}
