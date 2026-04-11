import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudMobilityWorkspaceDetail,
  EnsureCloudMobilityWorkspaceRequest,
} from "@/lib/integrations/cloud/client";
import { ensureCloudMobilityWorkspace } from "@/lib/integrations/cloud/mobility";
import { applyCloudMobilityWorkspaceDetail } from "./mobility-cache";
import { cloudMobilityWorkspacesKey } from "./query-keys";

export function useEnsureCloudMobilityWorkspace() {
  const queryClient = useQueryClient();

  return useMutation<CloudMobilityWorkspaceDetail, Error, EnsureCloudMobilityWorkspaceRequest>({
    mutationFn: ensureCloudMobilityWorkspace,
    onSuccess: async (detail) => {
      applyCloudMobilityWorkspaceDetail(queryClient, detail);
      await queryClient.invalidateQueries({
        queryKey: cloudMobilityWorkspacesKey(),
      });
    },
  });
}
