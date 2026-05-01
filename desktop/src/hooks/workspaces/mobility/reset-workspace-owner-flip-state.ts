import { anyHarnessWorkspaceQueryKeyRoots } from "@anyharness/sdk-react";
import type { QueryClient } from "@tanstack/react-query";
import { clearCachedCloudConnections } from "@/lib/integrations/anyharness/runtime-target";

export async function resetWorkspaceOwnerFlipState(args: {
  queryClient: QueryClient;
  runtimeUrl: string;
  logicalWorkspaceId: string;
  previousWorkspaceId: string | null;
  previousCloudWorkspaceId?: string | null;
  nextCloudWorkspaceId?: string | null;
  clearWorkspaceRuntimeState: (
    workspaceId: string,
    options?: { clearSelection?: boolean; clearDraftUiKey?: string | null },
  ) => void;
}) {
  if (args.previousCloudWorkspaceId) {
    await clearCachedCloudConnections(args.previousCloudWorkspaceId);
  }
  if (args.nextCloudWorkspaceId) {
    await clearCachedCloudConnections(args.nextCloudWorkspaceId);
  }

  const queryRoots = new Set<string>();
  for (const key of [
    args.logicalWorkspaceId,
    args.previousWorkspaceId,
  ]) {
    if (!key) {
      continue;
    }
    for (const root of anyHarnessWorkspaceQueryKeyRoots(args.runtimeUrl, key)) {
      queryRoots.add(JSON.stringify(root));
    }
  }

  await Promise.all(Array.from(queryRoots, (serializedRoot) => {
    const queryKey = JSON.parse(serializedRoot) as readonly unknown[];
    return args.queryClient.cancelQueries({ queryKey, exact: false });
  }));

  for (const serializedRoot of queryRoots) {
    const queryKey = JSON.parse(serializedRoot) as readonly unknown[];
    args.queryClient.removeQueries({ queryKey, exact: false });
  }

  if (args.previousWorkspaceId) {
    args.clearWorkspaceRuntimeState(args.previousWorkspaceId);
  }
}
