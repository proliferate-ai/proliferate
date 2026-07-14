export {
  cloudRootKey,
  controlPlaneHealthKey,
  personalCloudOwnerKey,
  cloudBillingKey,
  cloudRepoBranchesKey,
  cloudWorktreeRetentionPolicyKey,
  cloudMobilityWorkspacesKey,
  cloudWorkspaceConnectionKey,
  isCloudWorkspaceConnectionQueryKey,
} from "@proliferate/cloud-sdk-react/lib/query-keys";
import {
  cloudWorkspaceConnectionKey,
  type CloudOwnerScope,
  type CloudOwnerSelectionKey,
} from "@proliferate/cloud-sdk-react/lib/query-keys";
export type { CloudOwnerScope, CloudOwnerSelectionKey };

export function cloudWorkspaceConnectionAuthorityKey(
  workspaceId: string,
  authorityScopeKey: string,
  owner?: CloudOwnerSelectionKey,
) {
  return [
    ...cloudWorkspaceConnectionKey(workspaceId, owner),
    "authority",
    authorityScopeKey,
  ] as const;
}
