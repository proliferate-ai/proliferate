import { useEffect, useMemo, useState } from "react";
import type { GitBranchRef } from "@anyharness/sdk";
import { useGitBranchesQuery } from "@anyharness/sdk-react";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";

const EMPTY_BRANCHES: GitBranchRef[] = [];

function resolveAutoDetectedBranch(branchRefs: GitBranchRef[]): string | null {
  const branches = branchRefs
    .filter((branch) => !branch.isRemote)
    .sort((a, b) => a.name.localeCompare(b.name));

  const gitDefault = branches.find((branch) => branch.isDefault)
    ?? branches.find((branch) => branch.name === "main")
    ?? branches[0];

  return gitDefault?.name ?? null;
}

export function useRepositorySettings(repository: SettingsRepositoryEntry | null) {
  const sourceRoot = repository?.sourceRoot ?? null;
  const repoConfig = useRepoPreferencesStore((state) =>
    sourceRoot ? state.repoConfigs[sourceRoot] : undefined,
  );
  const setRepoConfig = useRepoPreferencesStore((state) => state.setRepoConfig);
  const { data: branchRefs = EMPTY_BRANCHES } = useGitBranchesQuery({
    workspaceId: repository?.repoWorkspaceId ?? null,
    enabled: !!repository,
  });

  const branches = useMemo(
    () => branchRefs
      .filter((branch) => !branch.isRemote)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [branchRefs],
  );

  const effectiveAutoDetectedBranch = useMemo(
    () => resolveAutoDetectedBranch(branchRefs),
    [branchRefs],
  );

  const [setupDraft, setSetupDraft] = useState(repoConfig?.setupScript ?? "");

  useEffect(() => {
    setSetupDraft(repoConfig?.setupScript ?? "");
  }, [repoConfig?.setupScript, sourceRoot]);

  useEffect(() => {
    if (!sourceRoot) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (setupDraft !== (repoConfig?.setupScript ?? "")) {
        setRepoConfig(sourceRoot, { setupScript: setupDraft });
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [repoConfig?.setupScript, setRepoConfig, setupDraft, sourceRoot]);

  const explicitDefaultBranch = repoConfig?.defaultBranch ?? null;

  return {
    branches,
    explicitDefaultBranch,
    effectiveAutoDetectedBranch,
    setupDraft,
    setSetupDraft,
    setExplicitDefaultBranch: (branchName: string | null) => {
      if (!sourceRoot) {
        return;
      }
      setRepoConfig(sourceRoot, { defaultBranch: branchName });
    },
  };
}
