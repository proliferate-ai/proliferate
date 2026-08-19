import type { QueryClient } from "@tanstack/react-query";
import {
  anyHarnessGitDiffScopeKey,
  anyHarnessGitForceEpochKey,
} from "./query-keys.js";

export async function invalidateGitDiffCache(
  queryClient: QueryClient,
  cacheScopeKey: string,
  workspaceId: string | null | undefined,
): Promise<void> {
  const diffScopeKey = anyHarnessGitDiffScopeKey(cacheScopeKey, workspaceId);
  await queryClient.invalidateQueries({
    queryKey: diffScopeKey,
    refetchType: "none",
  });
  await queryClient.refetchQueries({
    queryKey: diffScopeKey,
    type: "active",
    // Generationless list keys add kind/baseRef and per-file keys add
    // scope/base/oldPath/path. Generated consumers add one more segment and
    // move to their new key when the force epoch advances, so refetch only the
    // active callers that intentionally retain the pre-generation identity.
    predicate: (query) => {
      const suffixLength = query.queryKey.length - diffScopeKey.length;
      return suffixLength === 2 || suffixLength === 4;
    },
  });
}

export function readGitCacheForceEpoch(
  queryClient: QueryClient,
  cacheScopeKey: string,
  workspaceId: string | null | undefined,
): number {
  if (!workspaceId) {
    return 0;
  }
  return queryClient.getQueryData<number>(
    anyHarnessGitForceEpochKey(cacheScopeKey, workspaceId),
  ) ?? 0;
}

export function advanceGitCacheForceEpoch(
  queryClient: QueryClient,
  cacheScopeKey: string,
  workspaceId: string | null | undefined,
): number {
  if (!workspaceId) {
    return 0;
  }
  let nextEpoch = 0;
  queryClient.setQueryData<number>(
    anyHarnessGitForceEpochKey(cacheScopeKey, workspaceId),
    (currentEpoch) => {
      nextEpoch = (currentEpoch ?? 0) + 1;
      return nextEpoch;
    },
  );
  return nextEpoch;
}
