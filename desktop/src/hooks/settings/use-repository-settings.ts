import { useEffect, useMemo, useState } from "react";
import type { GitBranchRef } from "@anyharness/sdk";
import {
  useRepoRootGitBranchesQuery,
} from "@anyharness/sdk-react";
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
  const { data: branchRefs = EMPTY_BRANCHES } = useRepoRootGitBranchesQuery({
    repoRootId: repository?.repoRootId ?? null,
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
  const [runCommandDraft, setRunCommandDraft] = useState(repoConfig?.runCommand ?? "");

  useEffect(() => {
    setSetupDraft(repoConfig?.setupScript ?? "");
  }, [repoConfig?.setupScript, sourceRoot]);

  useEffect(() => {
    setRunCommandDraft(repoConfig?.runCommand ?? "");
  }, [repoConfig?.runCommand, sourceRoot]);

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

  useEffect(() => {
    if (!sourceRoot) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (runCommandDraft !== (repoConfig?.runCommand ?? "")) {
        setRepoConfig(sourceRoot, { runCommand: runCommandDraft });
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [repoConfig?.runCommand, runCommandDraft, setRepoConfig, sourceRoot]);

  const explicitDefaultBranch = repoConfig?.defaultBranch ?? null;

  return {
    branches,
    explicitDefaultBranch,
    effectiveAutoDetectedBranch,
    setupDraft,
    setSetupDraft,
    runCommandDraft,
    setRunCommandDraft,
    setExplicitDefaultBranch: (branchName: string | null) => {
      if (!sourceRoot) {
        return;
      }
      setRepoConfig(sourceRoot, { defaultBranch: branchName });
    },
  };
}
