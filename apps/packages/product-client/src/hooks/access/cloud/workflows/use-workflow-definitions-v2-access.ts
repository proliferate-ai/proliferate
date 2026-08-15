import {
  useWorkflowDefinitionV2Actions,
  useWorkflowDefinitionV2Query,
  useWorkflowDefinitionsV2Query,
} from "@proliferate/cloud-sdk-react";

/**
 * Control-plane access for gen-2 workflow definitions: the list the main page
 * renders, the single record the builder edits, and the create/update/delete
 * mutations both write through.
 *
 * Grouped per surface family the way gen-1's `use-workflow-definition-access.ts`
 * groups its reads and writes, rather than split one file per endpoint. The
 * list query lives here even though the builder itself never calls it: the
 * seam belongs to the definitions family, not to whichever surface landed
 * first.
 */
export function useWorkflowDefinitionsV2ListAccess(
  authCacheScope: string,
  enabled = true,
) {
  return useWorkflowDefinitionsV2Query(authCacheScope, enabled);
}

/**
 * `definitionId === null` is the builder's "new workflow" case; the underlying
 * query disables itself rather than fetching, so callers pass the null through
 * instead of branching around the hook.
 */
export function useWorkflowDefinitionV2Access(
  definitionId: string | null,
  authCacheScope: string,
  enabled = true,
) {
  return useWorkflowDefinitionV2Query(definitionId, authCacheScope, enabled);
}

export function useWorkflowDefinitionV2MutationsAccess(authCacheScope: string) {
  return useWorkflowDefinitionV2Actions(authCacheScope);
}
