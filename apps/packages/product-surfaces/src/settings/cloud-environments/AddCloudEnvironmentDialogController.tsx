import {
  blockedCloudRepositoryReason,
} from "@proliferate/product-domain/environments/cloud-environments";
import { formatGitRepoId } from "@proliferate/product-domain/repos/repo-id";
import { AddCloudEnvironmentDialog } from "@proliferate/product-ui/environments/AddCloudEnvironmentDialog";
import type {
  AddCloudEnvironmentRepositoryView,
} from "@proliferate/product-ui/environments/AddCloudEnvironmentDialog";

import { useCloudEnvironmentAddActions } from "./useCloudEnvironmentAddActions";

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
