import type { TerminalRecord } from "@anyharness/sdk";
import { anyHarnessTerminalsKey } from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export function useTerminalCache() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);

  const invalidateWorkspaceTerminals = useCallback(async (workspaceId: string) => {
    await queryClient.invalidateQueries({
      queryKey: anyHarnessTerminalsKey(runtimeUrl, workspaceId),
    });
  }, [queryClient, runtimeUrl]);

  const setWorkspaceTerminalRecords = useCallback((
    workspaceId: string,
    records: TerminalRecord[],
  ) => {
    queryClient.setQueryData(anyHarnessTerminalsKey(runtimeUrl, workspaceId), records);
  }, [queryClient, runtimeUrl]);

  return {
    invalidateWorkspaceTerminals,
    setWorkspaceTerminalRecords,
  };
}
