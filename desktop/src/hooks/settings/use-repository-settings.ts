import { useCallback, useEffect, useMemo, useState } from "react";
import type { GitBranchRef } from "@anyharness/sdk";
import {
  useRepoRootGitBranchesQuery,
} from "@anyharness/sdk-react";
import {
  buildLocalEnvironmentSavePatch,
  isLocalEnvironmentDraftDirty,
  normalizeLocalEnvironmentDraft,
  type LocalEnvironmentDraft,
} from "@/lib/domain/settings/environment-draft";
import { resolveAutoDetectedBranch } from "@/lib/domain/settings/branch-selection";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";

const EMPTY_BRANCHES: GitBranchRef[] = [];

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

  const persistedDraft = useMemo(
    () => normalizeLocalEnvironmentDraft(repoConfig),
    [repoConfig],
  );
  const [state, setState] = useState<{
    sourceRoot: string | null;
    baseline: LocalEnvironmentDraft;
    draft: LocalEnvironmentDraft;
  }>(() => ({
    sourceRoot,
    baseline: persistedDraft,
    draft: persistedDraft,
  }));
  const dirty = isLocalEnvironmentDraftDirty(state.draft, state.baseline);

  useEffect(() => {
    setState((current) => {
      const sourceChanged = current.sourceRoot !== sourceRoot;
      const currentDirty = isLocalEnvironmentDraftDirty(current.draft, current.baseline);
      if (sourceChanged || !currentDirty) {
        return {
          sourceRoot,
          baseline: persistedDraft,
          draft: persistedDraft,
        };
      }

      return {
        ...current,
        baseline: persistedDraft,
      };
    });
  }, [persistedDraft, sourceRoot]);

  const setDraft = useCallback((patch: Partial<LocalEnvironmentDraft>) => {
    setState((current) => ({
      ...current,
      draft: normalizeLocalEnvironmentDraft({
        ...current.draft,
        ...patch,
      }),
    }));
  }, []);

  const save = useCallback(() => {
    if (!sourceRoot) {
      return;
    }
    const nextConfig = buildLocalEnvironmentSavePatch(state.draft);
    setRepoConfig(sourceRoot, nextConfig);
    setState((current) => ({
      ...current,
      baseline: nextConfig,
      draft: nextConfig,
    }));
  }, [setRepoConfig, sourceRoot, state.draft]);

  const revert = useCallback(() => {
    setState((current) => ({
      ...current,
      draft: current.baseline,
    }));
  }, []);

  const explicitDefaultBranch = state.draft.defaultBranch;

  return {
    branches,
    explicitDefaultBranch,
    effectiveAutoDetectedBranch,
    setupDraft: state.draft.setupScript,
    setSetupDraft: (setupScript: string) => setDraft({ setupScript }),
    runCommandDraft: state.draft.runCommand,
    setRunCommandDraft: (runCommand: string) => setDraft({ runCommand }),
    setExplicitDefaultBranch: (branchName: string | null) => {
      setDraft({ defaultBranch: branchName });
    },
    dirty,
    canSave: Boolean(sourceRoot && dirty),
    canRevert: Boolean(sourceRoot && dirty),
    save,
    revert,
  };
}
