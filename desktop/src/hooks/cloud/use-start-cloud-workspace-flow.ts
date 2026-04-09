import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { listCloudRepoConfigs } from "@/lib/integrations/cloud/repo-configs";
import type { NewCloudWorkspaceSeed } from "@/lib/domain/workspaces/cloud-workspace-creation";
import { buildCloudRepoSettingsHref } from "@/lib/domain/settings/navigation";
import { cloudRepoConfigsKey } from "./query-keys";

interface UseStartCloudWorkspaceFlowArgs {
  onOpenCloudDialog: (seed: NewCloudWorkspaceSeed) => void;
}

export function useStartCloudWorkspaceFlow({
  onOpenCloudDialog,
}: UseStartCloudWorkspaceFlowArgs) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useCallback(async (seed: NewCloudWorkspaceSeed) => {
    try {
      const payload = await queryClient.fetchQuery({
        queryKey: cloudRepoConfigsKey(),
        queryFn: () => listCloudRepoConfigs(),
      });
      const configured = payload.configs.some(
        (config) =>
          config.gitOwner === seed.gitOwner
          && config.gitRepoName === seed.gitRepoName
          && config.configured,
      );

      if (configured) {
        onOpenCloudDialog(seed);
        return;
      }
    } catch {
      onOpenCloudDialog(seed);
      return;
    }

    navigate(buildCloudRepoSettingsHref(seed.gitOwner, seed.gitRepoName));
  }, [navigate, onOpenCloudDialog, queryClient]);
}
