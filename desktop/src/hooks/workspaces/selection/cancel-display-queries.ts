import { anyHarnessWorkspaceQueryKeyRoots } from "@anyharness/sdk-react";
import type { QueryClient } from "@tanstack/react-query";

export function cancelPreviousWorkspaceDisplayQueries(input: {
  queryClient: QueryClient;
  runtimeUrl: string;
  previousWorkspaceIds: readonly (string | null | undefined)[];
  nextWorkspaceIds: readonly (string | null | undefined)[];
}): void {
  if (typeof input.queryClient.cancelQueries !== "function") {
    return;
  }

  const nextIds = new Set(input.nextWorkspaceIds.filter(Boolean));
  const roots = new Set<string>();
  for (const workspaceId of input.previousWorkspaceIds) {
    if (!workspaceId || nextIds.has(workspaceId)) {
      continue;
    }
    for (const root of anyHarnessWorkspaceQueryKeyRoots(input.runtimeUrl, workspaceId)) {
      roots.add(JSON.stringify(root));
    }
  }

  for (const serializedRoot of roots) {
    const queryKey = JSON.parse(serializedRoot) as readonly unknown[];
    void input.queryClient.cancelQueries({ queryKey, exact: false });
  }
}
