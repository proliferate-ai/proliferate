import { useEffect, useMemo, useState } from "react";
import type { CloudGitRepositorySummary } from "@proliferate/cloud-sdk";
import {
  useCloudGitRepositories,
  useCloudRepoConfigs,
  useLoadCloudRepoConfig,
  useSaveCloudRepoConfig,
  useValidateCloudRepoBranches,
} from "@proliferate/cloud-sdk-react";
import {
  blockedCloudRepositoryBranchReason,
  blockedCloudRepositoryReason,
  buildCloudEnvironmentListItems,
  buildMinimalCloudEnvironmentConfigRequest,
  buildReenableCloudEnvironmentConfigRequest,
} from "@proliferate/product-domain/environments/cloud-environments";
import {
  formatGitRepoId,
  parseGitRepoId,
  type GitRepoIdentity,
} from "@proliferate/product-domain/repos/repo-id";
import { AddCloudEnvironmentDialog } from "@proliferate/product-ui/environments/AddCloudEnvironmentDialog";
import type { AddCloudEnvironmentRepositoryView } from "@proliferate/product-ui/environments/AddCloudEnvironmentDialog";
import { CloudEnvironmentList } from "@proliferate/product-ui/environments/CloudEnvironmentList";
import { CloudEnvironmentDetail } from "./cloud-environments/CloudEnvironmentDetail";

const REPO_PAGE_LIMIT = 50;

export interface LocalCheckoutView {
  id: string;
  name: string;
  description: string;
  gitOwner?: string | null;
  gitRepoName?: string | null;
}

export interface CloudEnvironmentRepoSelection {
  gitOwner: string;
  gitRepoName: string;
}

export interface CloudEnvironmentsSettingsSurfaceProps {
  mode: "cloud-only" | "hybrid";
  localCheckouts?: readonly LocalCheckoutView[];
  selectedCloudRepo?: CloudEnvironmentRepoSelection | null;
  enabled?: boolean;
  cloudUnavailableReason?: string | null;
  onSelectCloudEnvironment: (repo: CloudEnvironmentRepoSelection) => void;
  onSelectLocalCheckout?: (sourceRoot: string) => void;
  onBackToList: () => void;
}

export function CloudEnvironmentsSettingsSurface({
  mode,
  localCheckouts = [],
  selectedCloudRepo = null,
  enabled = true,
  cloudUnavailableReason = null,
  onSelectCloudEnvironment,
  onSelectLocalCheckout,
  onBackToList,
}: CloudEnvironmentsSettingsSurfaceProps) {
  const [addOpen, setAddOpen] = useState(false);
  const repoConfigs = useCloudRepoConfigs(enabled);
  const localCheckoutsForDomain = useMemo(
    () => localCheckouts
      .filter((checkout) => checkout.gitOwner && checkout.gitRepoName)
      .map((checkout) => ({
        gitOwner: checkout.gitOwner!,
        gitRepoName: checkout.gitRepoName!,
        sourceRoot: checkout.id,
        name: checkout.name,
        secondaryLabel: checkout.description,
      })),
    [localCheckouts],
  );
  const cloudConfigByRepoId = useMemo(() => {
    const byId = new Map<string, { configured: boolean }>();
    for (const config of repoConfigs.data?.configs ?? []) {
      byId.set(formatGitRepoId({
        gitOwner: config.gitOwner,
        gitRepoName: config.gitRepoName,
      }), config);
    }
    return byId;
  }, [repoConfigs.data?.configs]);
  const cloudEnvironmentItems = useMemo(() => buildCloudEnvironmentListItems({
    configs: repoConfigs.data?.configs ?? [],
    localCheckouts: localCheckoutsForDomain,
  }), [localCheckoutsForDomain, repoConfigs.data?.configs]);

  if (selectedCloudRepo && enabled) {
    return (
      <CloudEnvironmentDetail
        gitOwner={selectedCloudRepo.gitOwner}
        gitRepoName={selectedCloudRepo.gitRepoName}
        enabled={enabled}
        onBack={onBackToList}
        onSaved={() => {
          void repoConfigs.refetch();
        }}
      />
    );
  }

  const resolvedCloudUnavailableReason = cloudUnavailableReason
    ?? (repoConfigs.isError ? "Cloud environments could not be loaded." : null);

  return (
    <>
      <CloudEnvironmentList
        title="Environments"
        description={mode === "hybrid"
          ? "Configure local checkouts and personal Cloud environments."
          : "Personal Cloud environments are GitHub repositories Proliferate can run without a local clone."}
        localCheckouts={mode === "hybrid" ? localCheckouts.map((checkout) => {
          const repoId = checkout.gitOwner && checkout.gitRepoName
            ? formatGitRepoId({
                gitOwner: checkout.gitOwner,
                gitRepoName: checkout.gitRepoName,
              })
            : null;
          const cloudConfig = repoId ? cloudConfigByRepoId.get(repoId) : null;
          return {
            id: checkout.id,
            name: checkout.name,
            description: checkout.description,
            cloudStatusLabel: cloudConfig
              ? cloudConfig.configured
                ? "Cloud enabled"
                : "Cloud disabled"
              : null,
          };
        }) : undefined}
        cloudEnvironments={cloudEnvironmentItems.map((environment) => ({
          id: environment.id,
          fullName: environment.fullName,
          description: environment.description,
          configured: environment.configured,
          localState: environment.localState,
          trackedFileCount: null,
        }))}
        loadingCloudEnvironments={enabled && repoConfigs.isLoading}
        cloudUnavailableReason={resolvedCloudUnavailableReason}
        onSelectLocalCheckout={mode === "hybrid" ? onSelectLocalCheckout : undefined}
        onSelectCloudEnvironment={(repoId) => {
          const parsed = parseGitRepoId(repoId);
          if (parsed) {
            onSelectCloudEnvironment(parsed);
          }
        }}
        onAddCloudEnvironment={enabled ? () => setAddOpen(true) : undefined}
        onRetryCloudEnvironments={enabled && repoConfigs.isError
          ? () => {
              void repoConfigs.refetch();
            }
          : undefined}
      />
      <AddCloudEnvironmentDialogController
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onEnvironmentAdded={(repoId) => {
          const parsed = parseGitRepoId(repoId);
          if (parsed) {
            onSelectCloudEnvironment(parsed);
          }
          void repoConfigs.refetch();
        }}
      />
    </>
  );
}

interface AddCloudEnvironmentDialogControllerProps {
  open: boolean;
  onClose: () => void;
  onEnvironmentAdded: (repoId: string) => void;
}

export function AddCloudEnvironmentDialogController({
  open,
  onClose,
  onEnvironmentAdded,
}: AddCloudEnvironmentDialogControllerProps) {
  const actions = useCloudEnvironmentAddActions({
    open,
    onEnvironmentAdded: (repoId) => {
      onEnvironmentAdded(repoId);
      onClose();
    },
  });

  const repositories: AddCloudEnvironmentRepositoryView[] = actions.repositories.map((repo) => ({
    id: formatGitRepoId(repo),
    fullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    private: repo.private,
    fork: repo.fork,
    archived: repo.archived,
    disabled: repo.disabled,
    permission: repo.permission ?? null,
    configured: repo.configured,
    repoConfigState: repo.repoConfigState,
    ownerAvatarUrl: repo.ownerAvatarUrl,
    pushedAt: repo.pushedAt,
    updatedAt: repo.updatedAt,
    disabledReason: blockedCloudRepositoryReason(repo),
  }));

  return (
    <AddCloudEnvironmentDialog
      open={open}
      query={actions.query}
      manualValue={actions.manualValue}
      repositories={repositories}
      loading={actions.loading}
      loadingMore={actions.loadingMore}
      addingRepoId={actions.addingRepoId}
      error={actions.error}
      nextCursor={actions.nextCursor}
      onQueryChange={actions.setQuery}
      onManualValueChange={actions.setManualValue}
      onAddRepository={(repo) => {
        void actions.addCatalogRepository(repo.id);
      }}
      onAddManual={() => {
        void actions.addManualRepository();
      }}
      onLoadMore={actions.loadMore}
      onRetry={() => {
        void actions.retry();
      }}
      onClose={onClose}
    />
  );
}

interface UseCloudEnvironmentAddActionsInput {
  open: boolean;
  onEnvironmentAdded: (repoId: string) => void;
}

function useCloudEnvironmentAddActions({
  open,
  onEnvironmentAdded,
}: UseCloudEnvironmentAddActionsInput) {
  const [query, setQuery] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<CloudGitRepositorySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addingRepoId, setAddingRepoId] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  const catalog = useCloudGitRepositories(
    {
      query: debouncedQuery || null,
      cursor,
      limit: REPO_PAGE_LIMIT,
    },
    open,
  );
  const validateBranches = useValidateCloudRepoBranches();
  const loadConfig = useLoadCloudRepoConfig();
  const saveConfig = useSaveCloudRepoConfig();

  useEffect(() => {
    if (!open) {
      setQuery("");
      setManualValue("");
      setCursor(null);
      setRepositories([]);
      setError(null);
      setAddingRepoId(null);
      return;
    }
    setCursor(null);
    setRepositories([]);
    setError(null);
  }, [debouncedQuery, open]);

  useEffect(() => {
    if (!catalog.data) {
      return;
    }
    setRepositories((current) =>
      cursor
        ? mergeRepositories(current, catalog.data.repositories)
        : catalog.data.repositories
    );
  }, [catalog.data, cursor]);

  useEffect(() => {
    if (catalog.error) {
      setError(catalog.error instanceof Error ? catalog.error.message : "Could not load GitHub repositories.");
    }
  }, [catalog.error]);

  const repositoryById = useMemo(() => {
    const byId = new Map<string, CloudGitRepositorySummary>();
    for (const repo of repositories) {
      byId.set(formatGitRepoId(repo), repo);
    }
    return byId;
  }, [repositories]);

  async function addCatalogRepository(repoId: string) {
    const repo = repositoryById.get(repoId);
    if (!repo) {
      setError("Repository is no longer available in this list.");
      return;
    }
    await addRepository(repo);
  }

  async function addManualRepository() {
    const parsed = parseGitRepoId(manualValue);
    if (!parsed) {
      setError("Enter a GitHub repository as owner/repo or a GitHub URL.");
      return;
    }
    await addRepository(parsed);
  }

  async function addRepository(repo: CloudGitRepositorySummary | GitRepoIdentity) {
    const repoId = formatGitRepoId(repo);
    setAddingRepoId(repoId);
    setError(null);
    try {
      if ("repoConfigState" in repo && repo.repoConfigState === "configured") {
        onEnvironmentAdded(repoId);
        return;
      }

      const catalogBlockedReason = "repoConfigState" in repo ? blockedCloudRepositoryReason(repo) : null;
      if (catalogBlockedReason) {
        throw new Error(catalogBlockedReason);
      }

      const branches = await validateBranches.mutateAsync({
        gitOwner: repo.gitOwner,
        gitRepoName: repo.gitRepoName,
      });
      const branchBlockedReason = blockedCloudRepositoryBranchReason(branches);
      if (branchBlockedReason) {
        throw new Error(branchBlockedReason);
      }

      if ("repoConfigState" in repo && repo.repoConfigState === "missing") {
        await saveConfig.mutateAsync({
          gitOwner: repo.gitOwner,
          gitRepoName: repo.gitRepoName,
          body: buildMinimalCloudEnvironmentConfigRequest(branches.defaultBranch),
        });
        onEnvironmentAdded(repoId);
        return;
      }

      const existingConfig = await loadConfig.mutateAsync({
        gitOwner: repo.gitOwner,
        gitRepoName: repo.gitRepoName,
      });
      if (existingConfig.configured) {
        onEnvironmentAdded(repoId);
        return;
      }

      await saveConfig.mutateAsync({
        gitOwner: repo.gitOwner,
        gitRepoName: repo.gitRepoName,
        body: buildReenableCloudEnvironmentConfigRequest(existingConfig, branches.defaultBranch),
      });
      onEnvironmentAdded(repoId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add cloud environment.");
    } finally {
      setAddingRepoId(null);
    }
  }

  return {
    query,
    manualValue,
    repositories,
    error,
    addingRepoId,
    nextCursor: catalog.data?.nextCursor ?? null,
    loading: catalog.isLoading,
    loadingMore: catalog.isFetching && cursor !== null,
    setQuery,
    setManualValue,
    addCatalogRepository,
    addManualRepository,
    retry: catalog.refetch,
    loadMore: () => {
      const nextCursor = catalog.data?.nextCursor ?? null;
      if (nextCursor && !catalog.isFetching) {
        setCursor(nextCursor);
      }
    },
  };
}

function mergeRepositories(
  current: CloudGitRepositorySummary[],
  incoming: CloudGitRepositorySummary[],
): CloudGitRepositorySummary[] {
  const byId = new Map<string, CloudGitRepositorySummary>();
  for (const repo of current) {
    byId.set(formatGitRepoId(repo), repo);
  }
  for (const repo of incoming) {
    byId.set(formatGitRepoId(repo), repo);
  }
  return Array.from(byId.values());
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);
  return debounced;
}
