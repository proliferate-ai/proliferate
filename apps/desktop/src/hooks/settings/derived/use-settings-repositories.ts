import { useMemo } from "react";
import { useRepoConfigs } from "@proliferate/cloud-sdk-react";
import {
  buildSettingsRepositoryEntries,
} from "@/lib/domain/settings/repositories";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useStandardRepoProjection } from "@/hooks/workspaces/derived/use-standard-repo-projection";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export function useSettingsRepositories() {
  const { localWorkspaces, repoRoots } = useStandardRepoProjection();
  const hiddenRepoRootIds = useWorkspaceUiStore((state) => state.hiddenRepoRootIds);
  const { cloudActive } = useCloudAvailabilityState();
  const repoConfigsQuery = useRepoConfigs(cloudActive);

  const repositories = useMemo(() => {
    const hiddenRepoRootIdSet = new Set(hiddenRepoRootIds);
    return buildSettingsRepositoryEntries(
      localWorkspaces.filter((workspace) =>
        workspace.repoRootId ? !hiddenRepoRootIdSet.has(workspace.repoRootId) : true
      ),
      repoRoots.filter((repoRoot) => !hiddenRepoRootIdSet.has(repoRoot.id)),
      repoConfigsQuery.data?.repositories ?? [],
    );
  }, [hiddenRepoRootIds, localWorkspaces, repoConfigsQuery.data?.repositories, repoRoots]);

  return {
    repositories,
    isLoadingCloudRepositories: repoConfigsQuery.isPending,
  };
}
