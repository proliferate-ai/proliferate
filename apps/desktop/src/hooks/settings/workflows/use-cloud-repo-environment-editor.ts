import { useEffect, useMemo } from "react";
import type { RepoEnvironmentResponse } from "@proliferate/cloud-sdk";
import {
  useGitHubRepoAuthority,
  useRepositories,
  useSaveRepoEnvironment,
} from "@proliferate/cloud-sdk-react";
import {
  buildCoreCloudEnvironmentSaveRequest,
  cloudEnvironmentStatusPresentation,
  type CloudEnvironmentStatusPresentation,
} from "@proliferate/product-domain/environments/cloud-environments";
import {
  useCloudEnvironmentDraft,
  type CloudEnvironmentDraft,
} from "@proliferate/product-surfaces/settings/cloud-environments/use-cloud-environment-draft";
import { useCloudRepoBranches } from "@/hooks/access/cloud/use-cloud-repo-branches";
import {
  isCloudRepository,
  type CloudSettingsRepositoryEntry,
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";

const MATERIALIZATION_POLL_INTERVAL_MS = 5000;

export interface CloudRepoEnvironmentEditor {
  /** Non-null when the repository is GitHub-backed (cloud-capable). */
  cloudRepository: CloudSettingsRepositoryEntry | null;
  /** Saved cloud environment config, null while unconfigured. */
  cloudEnvironment: RepoEnvironmentResponse | null;
  draft: CloudEnvironmentDraft;
  status: CloudEnvironmentStatusPresentation;
  saving: boolean;
  saveError: string | null;
  repoConfigsLoading: boolean;
  authority: ReturnType<typeof useGitHubRepoAuthority>;
  branches: {
    defaultBranch: string | null;
    names: readonly string[];
    loading: boolean;
    error: string | null;
  };
  save: () => Promise<void>;
  /** Real cloud-materialization entry — the same PUT the add flow uses, seeded from local prefs. */
  setUp: () => Promise<void>;
}

/**
 * Shared Cloud-context plumbing for the repo-scope settings pages: saved
 * environment lookup, GitHub App authority, branch list, the shared draft
 * state machine, save/set-up mutations, and a light refetch loop while a
 * materialization is pending/running (the repositories query has no polling).
 */
export function useCloudRepoEnvironmentEditor({
  repository,
  cloudActive,
}: {
  repository: SettingsRepositoryEntry;
  cloudActive: boolean;
}): CloudRepoEnvironmentEditor {
  const cloudRepository = isCloudRepository(repository) ? repository : null;
  const cloudQueryEnabled = cloudActive && cloudRepository !== null;
  const repoConfigs = useRepositories(cloudQueryEnabled);
  const authority = useGitHubRepoAuthority(
    {
      gitOwner: cloudRepository?.gitOwner,
      gitRepoName: cloudRepository?.gitRepoName,
    },
    cloudQueryEnabled,
  );
  const branchesQuery = useCloudRepoBranches(
    cloudRepository?.gitOwner ?? "",
    cloudRepository?.gitRepoName ?? "",
    cloudQueryEnabled,
  );
  const localSetupScript = useRepoPreferencesStore(
    (state) => state.repoConfigs[repository.sourceRoot]?.setupScript ?? "",
  );
  const localRunCommand = useRepoPreferencesStore(
    (state) => state.repoConfigs[repository.sourceRoot]?.runCommand ?? "",
  );
  const seed = useMemo(
    () => ({ setupScript: localSetupScript, runCommand: localRunCommand }),
    [localRunCommand, localSetupScript],
  );

  const cloudEnvironment = useMemo(() => {
    if (!cloudRepository) {
      return null;
    }
    const repo = repoConfigs.data?.repositories.find((candidate) =>
      candidate.gitProvider === "github"
      && candidate.gitOwner === cloudRepository.gitOwner
      && candidate.gitRepoName === cloudRepository.gitRepoName
    );
    return repo?.environments.find((environment) => environment.kind === "cloud") ?? null;
  }, [cloudRepository, repoConfigs.data?.repositories]);

  const draft = useCloudEnvironmentDraft({
    environment: cloudEnvironment,
    sourceKey: repository.sourceRoot,
    seed,
  });
  const saveEnvironment = useSaveRepoEnvironment();
  const status = cloudEnvironmentStatusPresentation({
    configured: cloudEnvironment !== null,
    dirty: draft.dirty,
    materializationStatus: cloudEnvironment?.materialization?.status ?? null,
  });

  const materializationStatus = cloudEnvironment?.materialization?.status ?? null;
  const refetchRepoConfigs = repoConfigs.refetch;
  useEffect(() => {
    if (materializationStatus !== "pending" && materializationStatus !== "running") {
      return;
    }
    const interval = setInterval(() => {
      void refetchRepoConfigs();
    }, MATERIALIZATION_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [materializationStatus, refetchRepoConfigs]);

  async function save() {
    if (!cloudRepository) {
      return;
    }
    const response = await saveEnvironment.mutateAsync({
      gitOwner: cloudRepository.gitOwner,
      gitRepoName: cloudRepository.gitRepoName,
      body: buildCoreCloudEnvironmentSaveRequest({
        defaultBranch: draft.defaultBranch,
        setupScript: draft.setupScript,
        runCommand: draft.runCommand,
      }),
    });
    draft.reset(response);
  }

  async function setUp() {
    if (!cloudRepository) {
      return;
    }
    await saveEnvironment.mutateAsync({
      gitOwner: cloudRepository.gitOwner,
      gitRepoName: cloudRepository.gitRepoName,
      body: buildCoreCloudEnvironmentSaveRequest({
        defaultBranch: null,
        setupScript: seed.setupScript,
        runCommand: seed.runCommand,
      }),
    });
    void repoConfigs.refetch();
  }

  return {
    cloudRepository,
    cloudEnvironment,
    draft,
    status,
    saving: saveEnvironment.isPending,
    saveError: saveEnvironment.error?.message ?? null,
    repoConfigsLoading: repoConfigs.isLoading,
    authority,
    branches: {
      defaultBranch: branchesQuery.data?.defaultBranch ?? null,
      names: branchesQuery.data?.branches ?? [],
      loading: branchesQuery.isLoading,
      error: branchesQuery.error instanceof Error ? branchesQuery.error.message : null,
    },
    save,
    setUp,
  };
}
