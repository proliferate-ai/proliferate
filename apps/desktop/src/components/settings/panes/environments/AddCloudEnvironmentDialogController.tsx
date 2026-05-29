import { useEffect, useMemo, useState } from "react";
import { AddCloudEnvironmentDialog } from "@proliferate/product-ui/environments/AddCloudEnvironmentDialog";
import type { AddCloudEnvironmentRepositoryView } from "@proliferate/product-ui/environments/AddCloudEnvironmentDialog";
import type { CloudGitRepositorySummary } from "@proliferate/cloud-sdk";
import {
  useCloudGitRepositories,
  useLoadCloudRepoConfig,
  useSaveCloudRepoConfig,
  useValidateCloudRepoBranches,
} from "@proliferate/cloud-sdk-react";
import {
  blockedCloudRepositoryBranchReason,
  blockedCloudRepositoryReason,
  buildMinimalCloudEnvironmentConfigRequest,
  buildReenableCloudEnvironmentConfigRequest,
} from "@proliferate/product-domain/environments/cloud-environments";
import {
  formatGitRepoId,
  parseGitRepoId,
  type GitRepoIdentity,
} from "@proliferate/product-domain/repos/repo-id";

const REPO_PAGE_LIMIT = 50;

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
      onAddRepository={(repo) => void actions.addCatalogRepository(repo.id)}
      onAddManual={() => void actions.addManualRepository()}
      onLoadMore={actions.loadMore}
      onRetry={() => void actions.retry()}
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
