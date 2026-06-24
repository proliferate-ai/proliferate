import { useMemo } from "react";
import {
  buildSettingsRepositoryEntries,
} from "@/lib/domain/settings/repositories";
import { useCloudRepoConfigs } from "@/hooks/access/cloud/use-cloud-repo-configs";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useStandardRepoProjection } from "@/hooks/workspaces/derived/use-standard-repo-projection";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export function useSettingsRepositories() {
  const { localWorkspaces, repoRoots } = useStandardRepoProjection();
  const hiddenRepoRootIds = useWorkspaceUiStore((state) => state.hiddenRepoRootIds);
  const { cloudActive } = useCloudAvailabilityState();
  const cloudRepoConfigsQuery = useCloudRepoConfigs(cloudActive);

  const repositories = useMemo(() => {
    const hiddenRepoRootIdSet = new Set(hiddenRepoRootIds);
    return buildSettingsRepositoryEntries(
      localWorkspaces.filter((workspace) =>
        workspace.repoRootId ? !hiddenRepoRootIdSet.has(workspace.repoRootId) : true
      ),
      repoRoots.filter((repoRoot) => !hiddenRepoRootIdSet.has(repoRoot.id)),
      cloudRepoConfigsQuery.data?.configs ?? [],
    );
  }, [cloudRepoConfigsQuery.data?.configs, hiddenRepoRootIds, localWorkspaces, repoRoots]);

  return {
    repositories,
    isLoadingCloudRepositories: cloudRepoConfigsQuery.isPending,
  };
}
