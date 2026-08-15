// Workflows gen-2 definition/invocation query keys, in their own module so
// the shared query-keys.ts stays under its size threshold. Same scope
// conventions: everything nests under cloudRootKey.

import { cloudRootKey } from "./query-keys.js";

export function workflowDefinitionsV2RootKey(
  apiBaseUrl: string,
  authCacheScope: string,
) {
  return [
    ...cloudRootKey(),
    "workflow-definitions-v2",
    apiBaseUrl,
    authCacheScope,
  ] as const;
}

export function workflowDefinitionsV2ListKey(
  apiBaseUrl: string,
  authCacheScope: string,
) {
  return [...workflowDefinitionsV2RootKey(apiBaseUrl, authCacheScope), "list"] as const;
}

export function workflowDefinitionV2DetailKey(
  apiBaseUrl: string,
  authCacheScope: string,
  workflowDefinitionId: string | null,
) {
  return [
    ...workflowDefinitionsV2RootKey(apiBaseUrl, authCacheScope),
    "detail",
    workflowDefinitionId,
  ] as const;
}

export function workflowInvocationsV2RootKey(apiBaseUrl: string, authCacheScope: string) {
  return [...cloudRootKey(), "workflow-invocations-v2", apiBaseUrl, authCacheScope] as const;
}

export function workflowInvocationV2Key(
  apiBaseUrl: string,
  authCacheScope: string,
  invocationId: string | null,
) {
  return [...workflowInvocationsV2RootKey(apiBaseUrl, authCacheScope), invocationId] as const;
}
