import { useMemo } from "react";
import {
  buildSettingsRepositoryEntries,
} from "@/lib/domain/settings/repositories";
import { useStandardRepoProjection } from "@/hooks/workspaces/use-standard-repo-projection";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export function useSettingsRepositories() {
  const { localWorkspaces, repoRoots } = useStandardRepoProjection();
  const hiddenRepoRootIds = useWorkspaceUiStore((state) => state.hiddenRepoRootIds);

  const repositories = useMemo(() => {
    const hiddenRepoRootIdSet = new Set(hiddenRepoRootIds);
    return buildSettingsRepositoryEntries(
      localWorkspaces.filter((workspace) =>
        workspace.repoRootId ? !hiddenRepoRootIdSet.has(workspace.repoRootId) : true
      ),
      repoRoots.filter((repoRoot) => !hiddenRepoRootIdSet.has(repoRoot.id)),
    );
  }, [hiddenRepoRootIds, localWorkspaces, repoRoots]);

  return {
    repositories,
  };
}
