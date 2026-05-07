import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudMobilityWorkspaceDetail,
  EnsureCloudMobilityWorkspaceRequest,
} from "@/lib/access/cloud/client";
import { ensureCloudMobilityWorkspace } from "@/lib/access/cloud/mobility";
import { applyCloudMobilityWorkspaceDetail } from "./mobility-cache";
import { cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";

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
