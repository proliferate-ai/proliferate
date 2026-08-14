import {
  useRepositories,
  useWorkflowInvocationV2Actions,
} from "@proliferate/cloud-sdk-react";

/**
 * Control-plane access the gen-2 trigger surface needs: the idempotent
 * invocation PUT that freezes a run's definition snapshot, and the repo
 * configs the placement picker offers.
 *
 * Grouped the way gen-1's `use-workflow-run-access.ts` groups a launch
 * surface's reads and writes, rather than split one file per endpoint.
 */
export function useWorkflowInvocationV2MutationsAccess(authCacheScope: string) {
  return useWorkflowInvocationV2Actions(authCacheScope);
}

export function useWorkflowTriggerRepositoriesAccess(
  authCacheScope: string,
  enabled = true,
) {
  return useRepositories(enabled, authCacheScope);
}
