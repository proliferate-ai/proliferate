import type { CoworkManagedWorkspaceSummary } from "@anyharness/sdk";
import { useCoworkManagedWorkspacesQuery } from "@anyharness/sdk-react";

const EMPTY_MANAGED_WORKSPACES: CoworkManagedWorkspaceSummary[] = [];

export function useCoworkManagedWorkspaces(
  sessionId: string | null | undefined,
  enabled = true,
) {
  const query = useCoworkManagedWorkspacesQuery(sessionId, {
    enabled: enabled && !!sessionId,
  });

  return {
    workspaces: query.data?.workspaces ?? EMPTY_MANAGED_WORKSPACES,
    isLoading: query.isLoading,
  };
}
