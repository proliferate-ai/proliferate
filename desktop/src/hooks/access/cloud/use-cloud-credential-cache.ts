import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { cloudCredentialsKey } from "@/hooks/access/cloud/query-keys";

export function useCloudCredentialCache() {
  const queryClient = useQueryClient();

  const invalidateCloudCredentials = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: cloudCredentialsKey() });
  }, [queryClient]);

  return {
    invalidateCloudCredentials,
  };
}
