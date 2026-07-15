import type { TerminalRecord } from "@anyharness/sdk";
import {
  anyHarnessTerminalsKey,
  useAnyHarnessCacheScopeKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export function useTerminalCache() {
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();

  const invalidateWorkspaceTerminals = useCallback(async (workspaceId: string) => {
    await queryClient.invalidateQueries({
      queryKey: anyHarnessTerminalsKey(cacheScopeKey, workspaceId),
    });
  }, [cacheScopeKey, queryClient]);

  const setWorkspaceTerminalRecords = useCallback((
    workspaceId: string,
    records: TerminalRecord[],
  ) => {
    queryClient.setQueryData(anyHarnessTerminalsKey(cacheScopeKey, workspaceId), records);
  }, [cacheScopeKey, queryClient]);

  return {
    invalidateWorkspaceTerminals,
    setWorkspaceTerminalRecords,
  };
}
