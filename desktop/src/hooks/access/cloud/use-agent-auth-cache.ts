import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { agentAuthRootKey } from "@proliferate/cloud-sdk-react/lib/query-keys";

export function useAgentAuthCache() {
  const queryClient = useQueryClient();

  const invalidateAgentAuth = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: agentAuthRootKey() });
  }, [queryClient]);

  return {
    invalidateAgentAuth,
  };
}
