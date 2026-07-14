import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { automationRunsKey } from "#product/hooks/access/cloud/automations/query-keys";
import { workspaceCollectionsScopeKey } from "#product/hooks/workspaces/cache/query-keys";

export function useLocalAutomationExecutorCache() {
  const queryClient = useQueryClient();

  const invalidateAfterLocalAutomationRun = useCallback(async (args: {
    automationId: string;
    runtimeUrl: string;
  }) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: automationRunsKey(args.automationId) }),
      queryClient.invalidateQueries({
        queryKey: workspaceCollectionsScopeKey(args.runtimeUrl),
      }),
    ]);
  }, [queryClient]);

  return {
    invalidateAfterLocalAutomationRun,
  };
}
