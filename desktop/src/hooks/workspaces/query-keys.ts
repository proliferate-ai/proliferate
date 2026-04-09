export function workspaceCollectionsScopeKey(runtimeUrl: string) {
  return ["workspaces", runtimeUrl] as const;
}

export function workspaceCollectionsKey(
  runtimeUrl: string,
  cloudAccessible: boolean,
) {
  return [...workspaceCollectionsScopeKey(runtimeUrl), cloudAccessible] as const;
}
