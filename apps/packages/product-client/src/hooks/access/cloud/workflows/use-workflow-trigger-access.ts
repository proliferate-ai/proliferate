import { useWorkflowInvocationV2Actions } from "@proliferate/cloud-sdk-react";

/**
 * Control-plane access the gen-2 trigger surface needs: the idempotent
 * invocation PUT that freezes a run's definition snapshot. The placement
 * picker does not read the control plane at all — v1 placement carries the
 * runtime's repo-root ids, sourced from `useRepoRootsQuery` in the dialog.
 */
export function useWorkflowInvocationV2MutationsAccess(authCacheScope: string) {
  return useWorkflowInvocationV2Actions(authCacheScope);
}
