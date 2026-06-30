import { useCallback, useEffect, useMemo, useState } from "react";
import type { GitBranchRef } from "@anyharness/sdk";
import {
  useRepoRootGitBranchesQuery,
} from "@anyharness/sdk-react";
import { useRepositories, useSaveRepoEnvironment } from "@proliferate/cloud-sdk-react";
import {
  buildLocalEnvironmentSavePatch,
  isLocalEnvironmentDraftDirty,
  normalizeLocalEnvironmentDraft,
  type LocalEnvironmentDraft,
} from "@/lib/domain/settings/environment-draft";
import { resolveAutoDetectedBranch } from "@/lib/domain/settings/branch-selection";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { loadAnonymousTelemetryBootstrap } from "@/lib/integrations/telemetry/anonymous-storage";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";

const EMPTY_BRANCHES: GitBranchRef[] = [];

// Owns repository settings form state and save/revert actions.
// Does not own repository discovery or workspace cache updates.
export function useRepositorySettings(repository: SettingsRepositoryEntry | null) {
  const sourceRoot = repository?.sourceRoot ?? null;
  const repoConfig = useRepoPreferencesStore((state) =>
    sourceRoot ? state.repoConfigs[sourceRoot] : undefined,
  );
  const setRepoConfig = useRepoPreferencesStore((state) => state.setRepoConfig);
  const saveEnvironment = useSaveRepoEnvironment();
  const repoConfigs = useRepositories(Boolean(repository?.gitOwner && repository.gitRepoName));
  const [desktopInstallId, setDesktopInstallId] = useState<string | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    void loadAnonymousTelemetryBootstrap()
      .then(({ installId }) => {
        if (!cancelled) {
          setDesktopInstallId(installId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDesktopInstallId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistedCloudLocalDraft = useMemo(() => {
    if (!repository?.gitOwner || !repository.gitRepoName || !sourceRoot || !desktopInstallId) {
      return null;
    }
    const gitProvider = repository.gitProvider ?? "github";
    const repo = repoConfigs.data?.repositories.find((item) =>
      item.gitProvider === gitProvider
      && item.gitOwner === repository.gitOwner
      && item.gitRepoName === repository.gitRepoName,
    );
    const environment = repo?.environments.find((item) =>
      item.kind === "local"
      && item.desktopInstallId === desktopInstallId
      && item.localPath === sourceRoot,
    );
    return environment
      ? normalizeLocalEnvironmentDraft({
          defaultBranch: environment.defaultBranch,
          setupScript: environment.setupScript,
          runCommand: environment.runCommand,
        })
      : null;
  }, [
    desktopInstallId,
    repoConfigs.data?.repositories,
    repository,
    sourceRoot,
  ]);

  const persistedDraft = useMemo(
    () => normalizeLocalEnvironmentDraft(repoConfig ?? persistedCloudLocalDraft),
    [persistedCloudLocalDraft, repoConfig],
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
    if (
      repository?.gitOwner
      && repository.gitRepoName
      && (repository.gitProvider ?? "github").toLowerCase() === "github"
    ) {
      const { gitOwner, gitRepoName } = repository;
      void (async () => {
        const installId = desktopInstallId
          ?? (await loadAnonymousTelemetryBootstrap()).installId;
        await saveEnvironment.mutateAsync({
          gitOwner,
          gitRepoName,
          body: {
            kind: "local",
            gitProvider: "github",
            desktopInstallId: installId,
            localPath: sourceRoot,
            defaultBranch: nextConfig.defaultBranch,
            setupScript: nextConfig.setupScript,
            runCommand: nextConfig.runCommand,
          },
        });
      })().catch(() => {
        // Local preferences remain authoritative when Cloud is unavailable.
      });
    }
    setState((current) => ({
      ...current,
      baseline: nextConfig,
      draft: nextConfig,
    }));
  }, [
    desktopInstallId,
    repository,
    saveEnvironment,
    setRepoConfig,
    sourceRoot,
    state.draft,
  ]);

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
