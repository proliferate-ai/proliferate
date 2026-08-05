import { useCallback, useEffect, useMemo, useState } from "react";
import type { CloudGitRepositorySummary } from "@proliferate/cloud-sdk";
import {
  blockedCloudRepositoryBranchReason,
  blockedCloudRepositoryReason,
  buildMinimalCloudEnvironmentConfigRequest,
} from "@proliferate/product-domain/environments/cloud-environments";
import {
  formatGitRepoId,
  parseGitRepoId,
  type GitRepoIdentity,
} from "@proliferate/product-domain/repos/repo-id";

import { useCloudEnvironmentAccess } from "#product/hooks/access/cloud/use-cloud-environment-access";
import { useGitHubRepositoryPickerAccess } from "#product/hooks/access/cloud/use-github-repository-picker-access";
import { useDebouncedValue } from "#product/hooks/ui/timing/use-debounced-value";
import {
  buildGitHubAppPrerequisiteBlocker,
  cloudEnvironmentAdminRequestCopy,
  githubSetupReturnSurface,
  mergeRepositories,
  projectCloudRepoPickerRepositories,
  repoAuthorityMessage,
} from "#product/lib/domain/workspaces/cloud/cloud-repo-picker-model";
import type { CloudRepoPickerProps } from "#product/lib/domain/workspaces/cloud/cloud-repo-picker-view";

const REPO_PAGE_LIMIT = 50;

export interface UseAddCloudEnvironmentInput {
  /** Gates every query — pass false while the picker is not on screen. */
  enabled: boolean;
  organizationId?: string | null;
  canManageGitHubAppInstallation?: boolean;
  userAuthorizationReturnTo?: string | null;
  installationReturnTo?: string | null;
  onOpenExternalUrl: (url: string) => void | Promise<void>;
  onCopyText: (value: string) => void | Promise<void>;
  /**
   * Hand a selected repository to the app-level ordered readiness host. When
   * provided, this hook owns discovery only and does not validate or save.
   */
  onRepositorySelected?: (repo: GitRepoIdentity) => void;
  onEnvironmentAdded: (repoId: string) => void;
}

/** Picker state and sequencing over the ProductClient Cloud access seams. */
export function useAddCloudEnvironment({
  enabled,
  organizationId = null,
  canManageGitHubAppInstallation = false,
  userAuthorizationReturnTo = null,
  installationReturnTo = null,
  onOpenExternalUrl,
  onCopyText,
  onRepositorySelected,
  onEnvironmentAdded,
}: UseAddCloudEnvironmentInput): CloudRepoPickerProps {
  const [query, setQuery] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<CloudGitRepositorySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addingRepoId, setAddingRepoId] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  const {
    userAuthorization,
    startUserAuthorization,
    installation,
    startInstallation,
    catalog,
  } = useGitHubRepositoryPickerAccess({
    enabled,
    organizationId,
    query: debouncedQuery || null,
    cursor,
    limit: REPO_PAGE_LIMIT,
  });
  const {
    validateAuthority,
    validateBranches,
    saveEnvironment,
  } = useCloudEnvironmentAccess();

  useEffect(() => {
    if (!enabled) {
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
  }, [debouncedQuery, enabled]);

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
      setError(catalog.error instanceof Error
        ? catalog.error.message
        : "Could not load GitHub repositories.");
    }
  }, [catalog.error]);

  const authorizeUser = useCallback(async () => {
    setError(null);
    const response = await startUserAuthorization.mutateAsync({
      returnTo: userAuthorizationReturnTo,
    });
    await onOpenExternalUrl(response.authorizationUrl);
  }, [onOpenExternalUrl, startUserAuthorization, userAuthorizationReturnTo]);

  const installGitHubApp = useCallback(async () => {
    if (!organizationId) {
      return;
    }
    setError(null);
    const response = await startInstallation.mutateAsync({
      organizationId,
      options: {
        returnTo: installationReturnTo,
      },
    });
    await onOpenExternalUrl(response.installationUrl);
  }, [installationReturnTo, onOpenExternalUrl, organizationId, startInstallation]);

  const copyAdminRequest = useCallback(() => {
    void onCopyText(cloudEnvironmentAdminRequestCopy());
  }, [onCopyText]);

  const blocker = useMemo(() => buildGitHubAppPrerequisiteBlocker({
    organizationId,
    canManageGitHubAppInstallation,
    userAuthorizationLoading: userAuthorization.isLoading,
    userAuthorizationConnected: userAuthorization.data?.connected === true,
    userAuthorizationNeedsReconnect: userAuthorization.data?.action === "reauthorize",
    authorizingUser: startUserAuthorization.isPending,
    installationLoading: installation.isLoading,
    installationInstalled: installation.data?.installed === true,
    installingGitHubApp: startInstallation.isPending,
    onAuthorizeUser: () => {
      void authorizeUser();
    },
    onInstallGitHubApp: () => {
      void installGitHubApp();
    },
    onCopyAdminRequest: copyAdminRequest,
    returnSurface: githubSetupReturnSurface(
      userAuthorizationReturnTo,
      installationReturnTo,
    ),
  }), [
    authorizeUser,
    canManageGitHubAppInstallation,
    copyAdminRequest,
    installation.data?.installed,
    installation.isLoading,
    installationReturnTo,
    installGitHubApp,
    organizationId,
    startInstallation.isPending,
    startUserAuthorization.isPending,
    userAuthorization.data?.action,
    userAuthorization.data?.connected,
    userAuthorization.isLoading,
    userAuthorizationReturnTo,
  ]);

  const repositoryById = useMemo(() => {
    const byId = new Map<string, CloudGitRepositorySummary>();
    for (const repo of repositories) {
      byId.set(formatGitRepoId(repo), repo);
    }
    return byId;
  }, [repositories]);

  const addRepository = useCallback(async (
    repo: CloudGitRepositorySummary | GitRepoIdentity,
  ) => {
    const repoId = formatGitRepoId(repo);
    setAddingRepoId(repoId);
    setError(null);
    try {
      const catalogBlockedReason = "repoConfigState" in repo
        ? blockedCloudRepositoryReason(repo)
        : null;
      if (catalogBlockedReason) {
        throw new Error(catalogBlockedReason);
      }

      if (onRepositorySelected) {
        onRepositorySelected({
          gitOwner: repo.gitOwner,
          gitRepoName: repo.gitRepoName,
        });
        return;
      }

      if ("repoConfigState" in repo && repo.repoConfigState === "configured") {
        onEnvironmentAdded(repoId);
        return;
      }

      const authority = await validateAuthority.mutateAsync({
        gitOwner: repo.gitOwner,
        gitRepoName: repo.gitRepoName,
      });
      if (!authority.authorized) {
        throw new Error(authority.message ?? repoAuthorityMessage(authority.status));
      }

      const branches = await validateBranches.mutateAsync({
        gitOwner: repo.gitOwner,
        gitRepoName: repo.gitRepoName,
      });
      const branchBlockedReason = blockedCloudRepositoryBranchReason(branches);
      if (branchBlockedReason) {
        throw new Error(branchBlockedReason);
      }

      await saveEnvironment.mutateAsync({
        gitOwner: repo.gitOwner,
        gitRepoName: repo.gitRepoName,
        body: buildMinimalCloudEnvironmentConfigRequest(branches.defaultBranch),
      });
      onEnvironmentAdded(repoId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add cloud environment.");
    } finally {
      setAddingRepoId(null);
    }
  }, [
    onEnvironmentAdded,
    onRepositorySelected,
    saveEnvironment,
    validateAuthority,
    validateBranches,
  ]);

  const addCatalogRepository = useCallback(async (repoId: string) => {
    const repo = repositoryById.get(repoId);
    if (!repo) {
      setError("Repository is no longer available in this list.");
      return;
    }
    await addRepository(repo);
  }, [addRepository, repositoryById]);

  const addManualRepository = useCallback(async () => {
    const parsed = parseGitRepoId(manualValue);
    if (!parsed) {
      setError("Enter a GitHub repository as owner/repo or a GitHub URL.");
      return;
    }
    await addRepository(parsed);
  }, [addRepository, manualValue]);

  const loadingRepositories = catalog.isLoading
    || (catalog.isFetching && cursor === null && repositories.length === 0);
  const repositoryModels = useMemo(
    () => projectCloudRepoPickerRepositories(repositories),
    [repositories],
  );
  const onAddRepository = useCallback((repo: { id: string }) => {
    void addCatalogRepository(repo.id);
  }, [addCatalogRepository]);
  const onAddManual = useCallback(() => {
    void addManualRepository();
  }, [addManualRepository]);
  const onRetry = useCallback(() => {
    void catalog.refetch();
  }, [catalog]);
  const onLoadMore = useCallback(() => {
    const nextCursor = catalog.data?.nextCursor ?? null;
    if (nextCursor && !catalog.isFetching) {
      setCursor(nextCursor);
    }
  }, [catalog.data?.nextCursor, catalog.isFetching]);

  return useMemo(() => ({
    query,
    manualValue,
    repositories: repositoryModels,
    blocker,
    error,
    addingRepoId,
    nextCursor: catalog.data?.nextCursor ?? null,
    loading: loadingRepositories,
    loadingMore: catalog.isFetching && cursor !== null,
    onQueryChange: setQuery,
    onManualValueChange: setManualValue,
    onAddRepository,
    onAddManual,
    onRetry,
    onLoadMore,
  }), [
    addingRepoId,
    blocker,
    catalog.data?.nextCursor,
    catalog.isFetching,
    cursor,
    error,
    loadingRepositories,
    manualValue,
    onAddManual,
    onAddRepository,
    onLoadMore,
    onRetry,
    query,
    repositoryModels,
  ]);
}
