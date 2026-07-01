import { useCallback } from "react";

interface UseSelectedCloudRuntimeActionsInput {
  canUseConnection: boolean;
  refetchConnection: () => Promise<unknown>;
}

export function useSelectedCloudRuntimeActions({
  canUseConnection,
  refetchConnection,
}: UseSelectedCloudRuntimeActionsInput) {
  const retry = useCallback(() => {
    void refetchConnection();
  }, [refetchConnection]);

  return {
    retry: canUseConnection ? retry : null,
    claim: null,
    claimPending: false,
  };
}
