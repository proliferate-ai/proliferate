import { useEffect, useMemo, useState } from "react";
import type { CloudGitRepositorySummary } from "@proliferate/cloud-sdk";
import {
  useGitHubAppUserAuthorizationStatus,
  useGitHubAppInstallationStatus,
  useGitHubAppAccessibleRepos,
  useStartGitHubAppUserAuthorization,
  useStartGitHubAppInstallation,
  useValidateGitHubRepoAuthority,
  useSaveRepoEnvironment,
  useValidateCloudRepoBranches,
} from "@proliferate/cloud-sdk-react";
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
import { AddCloudEnvironmentDialog } from "@proliferate/product-ui/environments/AddCloudEnvironmentDialog";
import type {
  AddCloudEnvironmentRepositoryView,
} from "@proliferate/product-ui/environments/AddCloudEnvironmentDialog";
import {
  buildGitHubAppPrerequisiteBlocker,
  mergeRepositories,
  repoAuthorityMessage,
} from "./add-cloud-environment-helpers";

const REPO_PAGE_LIMIT = 50;

interface AddCloudEnvironmentDialogControllerProps {
  open: boolean;
  organizationId?: string | null;
  canManageGitHubAppInstallation?: boolean;
  userAuthorizationReturnTo?: string | null;
  installationReturnTo?: string | null;
  onOpenExternalUrl?: (url: string) => void | Promise<void>;
  onClose: () => void;
  onEnvironmentAdded: (repoId: string) => void;
}

export function AddCloudEnvironmentDialogController({
  open,
  organizationId = null,
  canManageGitHubAppInstallation = false,
  userAuthorizationReturnTo = null,
  installationReturnTo = null,
  onOpenExternalUrl,
  onClose,
  onEnvironmentAdded,
}: AddCloudEnvironmentDialogControllerProps) {
  const actions = useCloudEnvironmentAddActions({
    open,
    organizationId,
    canManageGitHubAppInstallation,
    userAuthorizationReturnTo,
    installationReturnTo,
    onOpenExternalUrl,
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
      blocker={actions.blocker}
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
  organizationId: string | null;
  canManageGitHubAppInstallation: boolean;
  userAuthorizationReturnTo: string | null;
  installationReturnTo: string | null;
  onOpenExternalUrl?: (url: string) => void | Promise<void>;
  onEnvironmentAdded: (repoId: string) => void;
}

function useCloudEnvironmentAddActions({
  open,
  organizationId,
  canManageGitHubAppInstallation,
  userAuthorizationReturnTo,
  installationReturnTo,
  onOpenExternalUrl,
  onEnvironmentAdded,
}: UseCloudEnvironmentAddActionsInput) {
  const [query, setQuery] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<CloudGitRepositorySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addingRepoId, setAddingRepoId] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  const userAuthorization = useGitHubAppUserAuthorizationStatus(open);
  const startUserAuthorization = useStartGitHubAppUserAuthorization();
  const installation = useGitHubAppInstallationStatus(
    organizationId,
    open && organizationId !== null,
  );
  const startInstallation = useStartGitHubAppInstallation();
  const prerequisitesReady = userAuthorization.data?.connected === true
    && installation.data?.installed === true;
  const catalog = useGitHubAppAccessibleRepos(
    {
      query: debouncedQuery || null,
      cursor,
      limit: REPO_PAGE_LIMIT,
    },
    open && prerequisitesReady,
  );
  const validateAuthority = useValidateGitHubRepoAuthority();
  const validateBranches = useValidateCloudRepoBranches();
  const saveEnvironment = useSaveRepoEnvironment();

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
      setError(catalog.error instanceof Error
        ? catalog.error.message
        : "Could not load GitHub repositories.");
    }
  }, [catalog.error]);

  async function openExternalUrl(url: string) {
    if (onOpenExternalUrl) {
      await onOpenExternalUrl(url);
      return;
    }
    window.location.assign(url);
  }

  async function authorizeUser() {
    setError(null);
    const response = await startUserAuthorization.mutateAsync({
      returnTo: userAuthorizationReturnTo,
    });
    await openExternalUrl(response.authorizationUrl);
  }

  async function installGitHubApp() {
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
    await openExternalUrl(response.installationUrl);
  }

  function copyAdminRequest() {
    const message = [
      "Please install the Proliferate GitHub App for our organization",
      "so we can add Cloud environments.",
    ].join(" ");
    void navigator.clipboard?.writeText(message);
  }

  const blocker = buildGitHubAppPrerequisiteBlocker({
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
  });

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
  }

  const loadingRepositories =
    catalog.isLoading
    || (catalog.isFetching && cursor === null && repositories.length === 0);

  return {
    query,
    manualValue,
    repositories,
    blocker,
    error,
    addingRepoId,
    nextCursor: catalog.data?.nextCursor ?? null,
    loading: loadingRepositories,
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

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);
  return debounced;
}
